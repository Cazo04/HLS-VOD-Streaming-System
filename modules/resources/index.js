const express = require('express');
const fs = require('fs');
const path = require('path');
const pool = require('./db');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const cors = require('cors');

const app = express();

// Configure CORS to allow localhost
app.use(cors({
    origin: '*',
    credentials: true
}));
const PORT = process.env.PORT || 3002;
const RESOURCES_DIR = process.env.RESOURCES_DIR || path.join('/mnt/cephfs/', 'completed');
const ENCODED_DIR = process.env.ENCODED_DIR || path.join('/mnt/cephfs/', 'encoded');
const ENCODER_URL = process.env.ENCODER_URL || 'http://localhost:3003';

const max_replication = 2;

// Function to get media tracks by media_id
async function getMediaTracks(mediaId) {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM Media_track WHERE media_id = ?',
            [mediaId]
        );
        return rows;
    } catch (error) {
        console.error('Error fetching media tracks:', error);
        throw error;
    }
}

// Function to get media tracks by track_id
async function getMediaTrackById(trackId) {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM Media_track WHERE id = ?',
            [trackId]
        );
        return rows.length > 0 ? rows[0] : null;
    } catch (error) {
        console.error('Error fetching media track:', error);
        throw error;
    }
}

// Function to get fragments by track_id
async function getFragmentsByTrackId(trackId) {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM Fragment WHERE track_id = ?',
            [trackId]
        );
        return rows;
    } catch (error) {
        console.error('Error fetching fragments:', error);
        throw error;
    }
}

// Function to get fragment by id
async function getFragmentById(fragmentId) {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM Fragment WHERE id = ?',
            [fragmentId]
        );
        return rows.length > 0 ? rows[0] : null;
    } catch (error) {
        console.error('Error fetching fragment:', error);
        throw error;
    }
}

// Function to get media id by fragment id
async function getMediaIdByFragmentId(fragmentId) {
    try {
        const [rows] = await pool.query(
            'SELECT media_id FROM Media_track WHERE id = (SELECT track_id FROM Fragment WHERE id = ?)',
            [fragmentId]
        );
        return rows.length > 0 ? rows[0].media_id : null;
    } catch (error) {
        console.error('Error fetching media id:', error);
        throw error;
    }
}

// Function to get fragment and track details by fragment id
async function getFragmentAndTrackDetails(fragmentId) {
    try {
        const [rows] = await pool.query(
            'SELECT f.*, t.media_id, t.type, t.language FROM Fragment f JOIN Media_track t ON f.track_id = t.id WHERE f.id = ?',
            [fragmentId]
        );
        return rows.length > 0 ? rows[0] : null;
    } catch (error) {
        console.error('Error fetching fragment and track details:', error);
        throw error;
    }
}

// Function to create a new download permission
async function createDownloadPermission(resourceId, expiryDate = null, status = null) {
    try {
        const id = uuidv4();
        const now = new Date();

        const [result] = await pool.query(
            'INSERT INTO Download_permission (id, resource_id, expiry_date, status, created_at) VALUES (?, ?, ?, ?, ?)',
            [id, resourceId, expiryDate, status, now]
        );

        return { id, resource_id: resourceId, expiry_date: expiryDate, status, created_at: now };
    } catch (error) {
        console.error('Error creating download permission:', error);
        throw error;
    }
}

// Function to get download permission by id
async function getDownloadPermissionById(id) {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM Download_permission WHERE id = ?',
            [id]
        );
        return rows.length > 0 ? rows[0] : null;
    } catch (error) {
        console.error('Error fetching download permission:', error);
        throw error;
    }
}

// Middleware for parsing JSON bodies
app.use(express.json());

function changeMasterContent(content, tracks) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        // Handle #EXT-X-MEDIA lines with URI attribute
        if (lines[i].startsWith('#EXT-X-MEDIA')) {
            const uriMatch = lines[i].match(/URI="([^"]+)"/);
            if (uriMatch && uriMatch[1]) {
                const originalUri = uriMatch[1];

                const values = originalUri.split('/');
                const type = values[0];
                const language = values[1];

                const trackId = tracks.find(track => track.type === type && track.language === language).id;

                const absoluteUri = 't-' + trackId;
                lines[i] = lines[i].replace(`URI="${originalUri}"`, `URI="${absoluteUri}"`);

            }
        }
        // Handle #EXT-X-STREAM-INF lines (next line is the URI)
        else if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
            if (i + 1 < lines.length && !lines[i + 1].startsWith('#')) {
                // Replace the next line with an absolute URL
                const originalUrl = lines[i + 1].trim();
                const values = originalUrl.split('/');
                const type = values[0];
                const language = values[1];

                const trackId = tracks.find(track => track.type === type && track.language === language).id;

                lines[i + 1] = 't-' + trackId;

            }
        }
    }

    return lines.join('\n');
}

function changeTrackContent(content, fragments) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('#EXTINF')) {
            if (i + 1 < lines.length && !lines[i + 1].startsWith('#')) {
                const fragmentId = fragments.find(fragment => fragment.file_name === lines[i + 1].trim()).id;

                lines[i + 1] = 'f-' + fragmentId;
            }
        }
    }

    return lines.join('\n');
}

async function findNodesHoldFragment(fragment_id) {
    try {
        const [rows] = await pool.query(
            `SELECT n.connection_id, nr.id, nr.key, nr.auth_tag, nr.nonce, nr.hash 
            FROM Node n
            JOIN Node_resource nr ON n.id = nr.node_id
            WHERE nr.fragment_id = ?
            AND n.health = 'online'
            AND nr.status NOT IN ('pending', 'created')
            ORDER BY n.last_heartbeat DESC
            LIMIT 3`,
            [fragment_id]
        );
        return rows;
    }
    catch (error) {
        console.error('Error fetching node resources:', error);
        return [];
    }
}

app.get('/api/resources/:id_data', async (req, res) => {
    const id_data = req.params.id_data;

    if (!id_data) {
        return res.status(400).json({ error: 'Invalid resource ID' });
    }

    const type_data = id_data.substring(0, 1);
    const id = id_data.substring(2);

    //console.log(`Received request for: ${type_data}/${id}`);

    if (!type_data || !id) {
        return res.status(400).json({ error: 'Invalid resource ID' });
    }

    try {
        if (type_data === 'm') {
            const mediaPath = path.join(RESOURCES_DIR, id, 'hls');

            if (!await fs.existsSync(mediaPath)) {
                return res.status(404).json({ error: 'Resource not found' });
            }

            // Check if a master.m3u8 file already exists in the media directory
            const masterPlaylistPath = path.join(mediaPath, 'master.m3u8');

            //console.log(`Master playlist path: ${masterPlaylistPath}`);
            if (await fs.existsSync(masterPlaylistPath)) {
                // Set the proper HLS MIME type
                res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');

                // Get media tracks and then read and modify the master playlist
                await getMediaTracks(id)
                    .then(tracks => {
                        fs.readFile(masterPlaylistPath, 'utf8', (err, content) => {
                            if (err) {
                                console.error('Error reading master.m3u8:', err);
                                return res.status(500).json({ error: 'Error reading playlist file' });
                            }

                            const contentEdited = changeMasterContent(content, tracks);

                            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                            res.send(contentEdited);
                        });
                    })
                    .catch(error => {
                        console.error('Error processing master playlist:', error);
                        return res.status(500).json({ error: 'Error processing playlist file' });
                    });
            } else {
                return res.status(404).json({ error: 'Master playlist not found' });
            }
        } else
            if (type_data === 't') {
                const track = await getMediaTrackById(id);
                if (!track) {
                    return res.status(404).json({ error: 'Track not found' });
                }
                const mediaPath = path.join(RESOURCES_DIR, track.media_id, 'hls');
                const type = track.type;
                const language = track.language;
                const trackPath = path.join(mediaPath, type, language, 'output.m3u8');
                if (!await fs.existsSync(trackPath)) {
                    return res.status(404).json({ error: 'Track location not found' });
                }

                await getFragmentsByTrackId(track.id).then(fragments => {
                    fs.readFile(trackPath, 'utf8', (err, content) => {
                        if (err) {
                            console.error('Error reading track.m3u8:', err);
                            return res.status(500).json({ error: 'Error reading track file' });
                        }

                        const contentEdited = changeTrackContent(content, fragments);

                        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                        res.send(contentEdited);
                    });
                }
                ).catch(error => {
                    console.error('Error processing track playlist:', error);
                    return res.status(500).json({ error: 'Error processing track file' });
                });
            } else
                if (type_data === 'f') {
                    const fragment = await getFragmentAndTrackDetails(id);
                    if (!fragment) {
                        return res.status(404).json({ error: 'Fragment not found' });
                    }
                    if (!fragment.track_id || !fragment.media_id) {
                        return res.status(404).json({ error: 'Track information not found' });
                    }

                    const nodes = await findNodesHoldFragment(id);
                    if (nodes.length > 0) {
                        console.log(`Fragment ID: ${id}`);
                        console.log('Nodes:', JSON.stringify(nodes, null, 2));
                        return res.status(200).json(nodes);
                    }

                    const track = {
                        id: fragment.track_id,
                        media_id: fragment.media_id,
                        type: fragment.type,
                        language: fragment.language
                    };
                    const type = track.type;
                    const language = track.language;
                    const fragmentPath = path.join(RESOURCES_DIR, track.media_id, 'hls', type, language, fragment.file_name);
                    //console.log(fragmentPath);
                    if (!await fs.existsSync(fragmentPath)) {
                        return res.status(404).json({ error: 'Fragment location not found' });
                    }

                    res.sendFile(fragmentPath, (err) => {
                        if (err) {
                            //throw new Error('Error sending file');
                            console.error('Error sending file:', err);
                            //res.status(500).json({ error: 'Error sending file' });
                        }
                    });
                } else {
                    return res.status(400).json({ error: 'Invalid resource ID' });
                }
    }
    catch (error) {
        console.error('Error processing request:', error);
    }
});

async function getNodeResourcesByStatus(status) {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM Node_resource WHERE status = ?',
            [status]
        );
        return rows;
    } catch (error) {
        console.error('Error fetching node resources:', error);
        throw error;
    }
}

async function getDownloadPermissionByResourceId(resourceId) {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM Download_permission WHERE resource_id = ?',
            [resourceId]
        );
        return rows.length > 0 ? rows[0] : null;
    } catch (error) {
        console.error('Error fetching download permission:', error);
        throw error;
    }
}

async function updateDownloadPermission(id, expiryDate) {
    try {
        await pool.query(
            'UPDATE Download_permission SET expiry_date = ? WHERE id = ?',
            [expiryDate, id]
        );
        return true;
    } catch (error) {
        console.error('Error updating download permission:', error);
        throw error;
    }
}

async function deleteDownloadPermission(id) {
    try {
        await pool.query(
            'DELETE FROM Download_permission WHERE id = ?',
            [id]
        );
        return true;
    } catch (error) {
        console.error('Error deleting download permission:', error);
        throw error;
    }
}

//
async function callEncoder(resource_id, fragment_id, fragment_path, node_id) {
    console.log(`[ENCODER] [REQUEST] Encoding request received for resource: ${resource_id}`);

    if (!resource_id || !fragment_id || !fragment_path || !node_id) {
        console.log('[ENCODER] [ERROR] Missing required parameters');
        return false;
    }

    try {
        // Make POST request to encoder server
        console.log(`[ENCODER] [INFO] Sending request to encoder at: ${ENCODER_URL}`);

        const encoderResponse = await axios.post(`${ENCODER_URL}/encode`, {
            resource_id,
            fragment_id,
            fragment_path,
            node_id
        });

        const encoderData = encoderResponse.data;
        console.log(`[ENCODER] [SUCCESS] Received encryption data for resource: ${resource_id}`);

        // Update node resource data with encryption details
        const { key, nonce, auth_tag, hash } = encoderData;

        const now = new Date();

        await pool.query(
            `UPDATE Node_resource SET \`key\` = ?, nonce = ?, auth_tag = ?, hash = ?, updated_at = ?, status = 'pending' WHERE id = ?`,
            [key, nonce, auth_tag, hash, now, resource_id]
        );

        console.log(`[ENCODER] [UPDATE] Node resource ${resource_id} updated with encryption details`);

        return true;
    } catch (error) {
        console.error(`[ENCODER] [ERROR] Failed to process encoding request: ${error.message}`);
        if (error.response) {
            console.error(`[ENCODER] [ERROR] Encoder server responded with status: ${error.response.status}`);

        } else if (error.request) {
            console.error('[ENCODER] [ERROR] No response received from encoder server');
        } else {
            console.error('[ENCODER] [ERROR] Request failed before reaching encoder server');
        }
    }

    return false;
}

app.get('/allocation-notification', async (req, res) => {
    console.log('='.repeat(50));
    console.log(`[ALLOCATION] [START] Allocation notification processing started`);

    try {
        // Get all pending node resources
        const pendingResources = await getNodeResourcesByStatus('created');
        console.log(`[ALLOCATION] [FIND] Found ${pendingResources.length} created resources to process`);

        const results = [];
        const errors = [];

        // Process each pending resource
        for (const resource of pendingResources) {
            console.log(`[ALLOCATION] [PROCESS] Processing resource: ${resource.id} (Fragment: ${resource.fragment_id})`);

            try {
                const resourceId = resource.id;
                const fragmentId = resource.fragment_id;

                // Check if a download permission already exists
                const permission = await getDownloadPermissionByResourceId(resourceId);

                if (!permission) {
                    // Create new permission with a 24h expiry
                    const expiryDate = new Date();
                    expiryDate.setHours(expiryDate.getHours() + 24);

                    // Get fragment location
                    const fragment = await getFragmentAndTrackDetails(fragmentId);

                    if (!fragment) {
                        throw new Error('Fragment not found');
                    }

                    const fragmentPath = path.join(
                        RESOURCES_DIR,
                        fragment.media_id,
                        'hls',
                        fragment.type,
                        fragment.language,
                        fragment.file_name
                    );

                    // Call encoder to process the fragment
                    if (!await callEncoder(resourceId, fragmentId, fragmentPath, resource.node_id)) {
                        throw new Error('Failed to process encoding request');
                    }

                    const newPermission = await createDownloadPermission(resourceId, expiryDate, 'active');
                    console.log(`[ALLOCATION] [CREATE] Created new permission: ${newPermission.id} (expires in 24h)`);
                    results.push({ resourceId, fragmentId, action: 'created', permissionId: newPermission.id });
                } else {
                    if (permission.status === 'active') {
                        // Check if expired
                        const now = new Date();
                        if (permission.expiry_date && new Date(permission.expiry_date) < now) {
                            // Extend expiry by 24 hours
                            const newExpiryDate = new Date();
                            newExpiryDate.setHours(newExpiryDate.getHours() + 24);

                            await updateDownloadPermission(permission.id, newExpiryDate);
                            console.log(`[ALLOCATION] [EXTEND] Extended permission: ${permission.id} (new expiry in 24h)`);
                            results.push({ resourceId, fragmentId, action: 'extended', permissionId: permission.id });
                        } else {
                            console.log(`[ALLOCATION] [SKIP] Permission ${permission.id} still valid, no action needed`);
                            results.push({ resourceId, fragmentId, action: 'unchanged', permissionId: permission.id });
                        }
                    } else if (permission.status === 'completed') {
                        // Delete the permission
                        await deleteDownloadPermission(permission.id);
                        console.log(`[ALLOCATION] [DELETE] Deleted completed permission: ${permission.id}`);
                        results.push({ resourceId, fragmentId, action: 'deleted', permissionId: permission.id });
                    }
                }
            } catch (error) {
                console.error(`[ALLOCATION] [ERROR] Error processing resource ${resource.id}: ${error.message}`);
                errors.push({ resourceId: resource.id, error: error.message });
            }
        }

        // Log summary
        console.log('-'.repeat(50));
        console.log(`[ALLOCATION] [SUMMARY] Processed ${pendingResources.length} resources`);
        console.log(`[ALLOCATION] [SUCCESS] ${results.length}`);
        console.log(`[ALLOCATION] [ERRORS] ${errors.length}`);

        if (errors.length > 0) {
            console.log(`[ALLOCATION] [ERROR_DETAILS]`);
            errors.forEach(err => {
                console.log(`[ALLOCATION] [ERROR] Resource ${err.resourceId}: ${err.error}`);
            });
        }

        console.log('='.repeat(50));

        res.json({
            processed: pendingResources.length,
            success: results.length,
            errors: errors.length,
            results,
            errorDetails: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        console.error(`[ALLOCATION] [FATAL] ${error.message}`);
        console.log('='.repeat(50));
        res.status(500).json({ error: 'Error processing allocation notifications' });
    }
});

// Function to get all download permissions for a specific node
async function getNodeDownloadPermissions(nodeId) {
    try {
        const [rows] = await pool.query(
            `SELECT dp.* 
            FROM Download_permission dp 
            JOIN Node_resource nr ON dp.resource_id = nr.id 
            WHERE nr.node_id = ? AND dp.status = 'active'`,
            [nodeId]
        );
        return rows;
    } catch (error) {
        console.error('Error fetching node download permissions:', error);
        throw error;
    }
}

// API endpoint to get all download permissions for a node
app.get('/node/:nodeId/permissions', async (req, res) => {
    const nodeId = req.params.nodeId;

    console.log(`[NODE_PERMISSIONS] [REQUEST] [${nodeId}] Permission list requested`);

    try {
        if (!nodeId) {
            return res.status(400).json({ error: 'Node ID is required' });
        }

        const permissions = await getNodeDownloadPermissions(nodeId);

        console.log(`[NODE_PERMISSIONS] [INFO] [${nodeId}] Found ${permissions.length} active permissions`);

        return res.json(permissions);
    } catch (error) {
        console.error(`[NODE_PERMISSIONS] [ERROR] [${nodeId}] Failed to fetch permissions:`, error);
        return res.status(500).json({ error: 'Error fetching node permissions' });
    }
});

// Function to get download permission with associated node resource data in one query
async function getPermissionWithNodeResource(permissionId) {
    try {
        const [rows] = await pool.query(
            `SELECT 
                dp.id AS permission_id, 
                dp.resource_id, 
                dp.expiry_date, 
                dp.status AS permission_status, 
                dp.created_at AS permission_created_at,
                nr.id AS resource_id,
                nr.fragment_id, 
                nr.node_id, 
                nr.status AS resource_status
            FROM Download_permission dp 
            JOIN Node_resource nr ON dp.resource_id = nr.id 
            WHERE dp.id = ?`,
            [permissionId]
        );

        if (rows.length === 0) return null;

        const row = rows[0];

        // Restructure to avoid status name collision
        return {
            id: row.permission_id,
            resource_id: row.resource_id,
            expiry_date: row.expiry_date,
            fragment_id: row.fragment_id,
            node_id: row.node_id,
            dp: {
                status: row.permission_status
            }
        };
    } catch (error) {
        console.error('Error fetching permission with node resource:', error);
        throw error;
    }
}

// Function to update node resource status
async function updateNodeResourceStatus(resourceId, status) {
    try {
        if (status === "stored") {
            // Update status and updated_at timestamp when status is "stored"
            await pool.query(
                'UPDATE Node_resource SET status = ?, updated_at = NOW() WHERE id = ?',
                [status, resourceId]
            );
            console.log(`📝 Updated resource ${resourceId} status to: ${status} with new timestamp`);
        } else {
            // Only update status for other statuses
            await pool.query(
                'UPDATE Node_resource SET status = ? WHERE id = ?',
                [status, resourceId]
            );
            console.log(`📝 Updated resource ${resourceId} status to: ${status}`);
        }
        return true;
    } catch (error) {
        console.error(`❌ Failed to update status for resource ${resourceId}:`, error);
        throw error;
    }
}

// Endpoint to download a fragment with permission verification
app.get('/api/download/:permissionId', async (req, res) => {
    const permissionId = req.params.permissionId;
    const nodeId = req.query.nodeId || req.headers['x-node-id'];

    console.log(`[REQUEST] [${permissionId}] Download request received`);

    try {
        // Validate basic requirements
        if (!nodeId) {
            console.log(`[ERROR] [${permissionId}] Missing Node ID`);
            return res.status(401).json({ error: 'Node ID is required' });
        }

        // Get permission with related resource data
        console.log(`[VERIFY] [${permissionId}] Checking permission`);
        const permissionWithResource = await getPermissionWithNodeResource(permissionId);

        // Check if permission exists
        if (!permissionWithResource) {
            console.log(`[ERROR] [${permissionId}] Permission not found`);
            return res.status(404).json({ error: 'Download permission not found' });
        }
        console.log(`[INFO] [${permissionId}] Permission found`);

        // Extract important data
        const resourceId = permissionWithResource.resource_id;
        const fragmentId = permissionWithResource.fragment_id;

        // Verify permission status and expiration
        if (permissionWithResource.dp.status !== 'active') {
            console.log(`[ERROR] [${permissionId}] Invalid status - ${permissionWithResource.dp.status}`);
            return res.status(403).json({ error: 'Download permission is not active' });
        }

        const now = new Date();
        if (permissionWithResource.expiry_date && new Date(permissionWithResource.expiry_date) < now) {
            console.log(`[ERROR] [${permissionId}] Permission expired`);
            return res.status(403).json({ error: 'Download permission has expired' });
        }
        console.log(`[INFO] [${permissionId}] Permission valid`);

        // Verify node authorization
        if (permissionWithResource.node_id !== nodeId) {
            console.log(`[ERROR] [${permissionId}] Unauthorized node access`);
            return res.status(403).json({ error: 'Node not authorized for this resource' });
        }
        console.log(`[INFO] [${permissionId}] Node authorized for fragment ${fragmentId}`);

        // // Get fragment details
        // const fragment = await getFragmentAndTrackDetails(fragmentId);

        // if (!fragment) {
        //     console.log(`[ERROR] [${permissionId}] Fragment not found`);
        //     return res.status(404).json({ error: 'Fragment not found' });
        // }

        // // Build file path
        // const fragmentPath = path.join(
        //     RESOURCES_DIR,
        //     fragment.media_id,
        //     'hls',
        //     fragment.type,
        //     fragment.language,
        //     fragment.file_name
        // );

        // // Check file existence
        // if (!fs.existsSync(fragmentPath)) {
        //     console.log(`[ERROR] [${permissionId}] Fragment file not found on disk`);
        //     return res.status(404).json({ error: 'Fragment file not found' });
        // }

        // // Prepare to send file
        // const fileStats = fs.statSync(fragmentPath);

        const resourcePath = path.join(ENCODED_DIR, resourceId);

        // Check file existence
        if (!fs.existsSync(resourcePath)) {
            console.log(`[ERROR] [${permissionId}] Resource file not found on disk`);
            return res.status(404).json({ error: 'Resource file not found' });
        }

        // Prepare to send file
        const fileStats = fs.statSync(resourcePath);
        const fileSize = fileStats.size;
        console.log(`[INFO] [${permissionId}] Sending file (${fileSize} bytes)`);

        // Track download completion
        let responseClosed = false;

        // Check if this is a HEAD request
        if (req.method === 'HEAD') {
            console.log(`[INFO] [${permissionId}] HEAD request - sending headers only`);
            res.setHeader('Content-Length', fileSize);
            res.setHeader('Content-Type', 'video/mp2t');
            return res.end();
        }

        // Handle successful transfer - only for regular GET requests
        res.on('finish', () => {
            if (!responseClosed) {
                console.log(`[SUCCESS] [${permissionId}] File sent completely`);

                // Update status to completed when download finishes successfully
                updateNodeResourceStatus(resourceId, 'stored')
                    .then(() => console.log(`[UPDATE] [${permissionId}] Fragment ${fragmentId} delivered to node ${nodeId}`))
                    .catch(error => console.error(`[ERROR] [${permissionId}] Failed to update resource status`));

                // Delete the download permission after successful transfer
                deleteDownloadPermission(permissionId)
                    .then(() => console.log(`[DELETE] [${permissionId}] Permission deleted`))
                    .catch(error => console.error(`[ERROR] [${permissionId}] Failed to delete permission`));

                // Detele the resource file after successful transfer
                fs.unlink(resourcePath
                    , (err) => {
                        if (err) {
                            console.error(`[ERROR] [${permissionId}] Failed to delete resource file`);
                        } else {
                            console.log(`[DELETE] [${permissionId}] Resource file deleted`);
                        }
                    }
                );

            }
        });

        // Handle interrupted transfer - only for regular GET requests
        res.on('close', () => {
            responseClosed = true;

            if (!res.writableEnded) {
                console.log(`[WARN] [${permissionId}] Transfer interrupted`);

                // Reset status if download was interrupted
                updateNodeResourceStatus(resourceId, 'pending')
                    .then(() => console.log(`[UPDATE] [${permissionId}] Status reset to pending`))
                    .catch(error => console.error(`[ERROR] [${permissionId}] Failed to reset resource status`));
            }
        });

        // Send the file
        res.sendFile(resourcePath, (err) => {
            if (err) {
                console.error(`[ERROR] [${permissionId}] Failed to send file`);

                // Set status to pending on error
                updateNodeResourceStatus(resourceId, 'pending')
                    .catch(error => console.error(`[ERROR] [${permissionId}] Failed to reset resource status`));

                res.status(500).json({ error: 'Error sending file' });
            }
        });
    } catch (error) {
        console.error(`[ERROR] [${permissionId}] Unexpected error: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Function to get all resource IDs from the database
async function getAllResourceIds() {
    try {
        const [rows] = await pool.query('SELECT id FROM Node_resource');
        return rows.map(row => row.id);
    } catch (error) {
        console.error('Error fetching resource IDs:', error);
        return [];
    }
}

// Function to clean up orphaned resource files
async function cleanupOrphanedResources() {
    console.log('[CLEANUP] Starting orphaned resource cleanup process');

    try {
        // Get all valid resource IDs from the database
        const resourceIds = await getAllResourceIds();
        console.log(`[CLEANUP] Found ${resourceIds.length} valid resources in database`);

        // Check if ENCODED_DIR exists
        if (!fs.existsSync(ENCODED_DIR)) {
            console.log(`[CLEANUP] Encoded directory does not exist: ${ENCODED_DIR}`);
            return;
        }

        // Read all files in the ENCODED_DIR
        const files = fs.readdirSync(ENCODED_DIR);
        console.log(`[CLEANUP] Found ${files.length} files in encoded directory`);

        let deletedCount = 0;

        // Process each file
        for (const file of files) {
            // Skip any directory or special files
            const filePath = path.join(ENCODED_DIR, file);
            if (!fs.statSync(filePath).isFile()) {
                continue;
            }

            // Check if the filename exists in the database
            if (!resourceIds.includes(file)) {
                console.log(`[CLEANUP] Deleting orphaned resource file: ${file}`);

                try {
                    // Delete the file
                    fs.unlinkSync(filePath);
                    deletedCount++;
                } catch (err) {
                    console.error(`[CLEANUP] Failed to delete ${file}: ${err.message}`);
                }
            }
        }

        console.log(`[CLEANUP] Cleanup completed. Deleted ${deletedCount} orphaned resources`);
    } catch (error) {
        console.error(`[CLEANUP] Error during cleanup process: ${error.message}`);
    }
}

// Set up interval to run cleanup every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds
setInterval(cleanupOrphanedResources, CLEANUP_INTERVAL);

// Run an initial cleanup when the server starts
cleanupOrphanedResources();

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Resource directory: ${RESOURCES_DIR}`);
});