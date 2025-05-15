const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { createHash } = require('blake2');
const { v7: uuidv7 } = require('uuid');
const pool = require('./db');

const app = express();
const port = 3000;
const BASE_DIR = process.env.BASE_DIR || path.join(__dirname, 'completed');

// Function to create a new media track record
async function createMediaTrack(mediaTrackData) {
    const {
        mediaId,
        type,
        language,
        status
    } = mediaTrackData;
    const id = uuidv7();
    const query = `
        INSERT INTO Media_track (id, media_id, type, language, updated_at, status)
        VALUES (?, ?, ?, ?, NOW(), ?)
    `;

    try {
        await pool.query(query, [id, mediaId, type, language, status]);
        return id;
    } catch (error) {
        console.error('Error creating media track:', error);
        throw error;
    }
}

// Function to update an existing media track record
async function updateMediaTrack(id, updates = {}) {
    // Build the SET part of the query dynamically based on provided updates
    const setClause = Object.entries(updates)
        .map(([key, _]) => `${key} = ?`)
        .join(', ');

    const values = Object.values(updates);

    // Always update the updated_at timestamp
    const query = `
        UPDATE Media_track 
        SET ${setClause}, updated_at = NOW()
        WHERE id = ?
    `;

    try {
        await pool.query(query, [...values, id]);
    } catch (error) {
        console.error('Error updating media track:', error);
        throw error;
    }
}

// Function to delete media tracks by type
async function deleteMediaTrackByType(mediaId, type) {
    const query = `
        DELETE FROM Media_track
        WHERE media_id = ? AND type = ?
    `;

    try {
        await pool.query(query, [mediaId, type]);
    } catch (error) {
        console.error('Error deleting media tracks by type:', error);
        throw error;
    }
}

// Function to create a new fragment record
async function createFragment(fragmentData) {
    const {
        trackId,
        hash,
        nodes,
        status,
        size,
        file_name
    } = fragmentData;

    const id = uuidv7();
    const query = `
        INSERT INTO Fragment (id, track_id, hash, nodes, updated_at, status, size, file_name)
        VALUES (?, ?, ?, ?, NOW(), ?, ?, ?)
    `;

    try {
        await pool.query(query, [id, trackId, hash, nodes, status, size, file_name]);
        return id;
    } catch (error) {
        console.error('Error creating fragment:', error);
        throw error;
    }
}

// Function to calculate Blake2b hash of a file
async function calculateBlake2bHash(filePath) {
    const fileData = await fs.readFile(filePath);
    const h = createHash('blake2b');
    h.update(fileData);
    return h.digest('hex');
}

async function handleAudios(folderPath) {
    const results = {};

    for (const languageFolder of await fs.readdir(folderPath)) {

        const languageFolderPath = path.join(folderPath, languageFolder);
        const stats = await fs.stat(languageFolderPath);
        if (stats.isDirectory()) {

            //console.log('Language:', languageFolder);

            results[languageFolder] = {};

            for (const file of await fs.readdir(languageFolderPath)) {
                const filePath = path.join(languageFolderPath, file);
                const stats = await fs.stat(filePath);
                if (stats.isFile()) {
                    if (file.endsWith('.m3u8')) {
                        continue;
                    }

                    //console.log('File:', file);

                    const hash = await calculateBlake2bHash(filePath);
                    results[languageFolder][file] = {
                        hash: hash,
                        size: stats.size
                    };
                }
            }
        }
    }

    return results;
}

async function handleSubtitles(folderPath) {
    const results = {};

    for (const languageFolder of await fs.readdir(folderPath)) {

        const languageFolderPath = path.join(folderPath, languageFolder);
        const stats = await fs.stat(languageFolderPath);
        if (stats.isDirectory()) {

            //console.log('Language:', languageFolder);

            results[languageFolder] = {};

            for (const file of await fs.readdir(languageFolderPath)) {
                const filePath = path.join(languageFolderPath, file);
                const stats = await fs.stat(filePath);
                if (stats.isFile()) {
                    if (file.endsWith('.m3u8')) {
                        continue;
                    }
                    //console.log('File:', file);

                    const hash = await calculateBlake2bHash(filePath);

                    results[languageFolder][file] = {
                        hash: hash,
                        size: stats.size
                    };
                }
            }
        }
    }

    return results;
}

async function handleVideos(folderPath) {
    const results = {};

    for (const qualityFolder of await fs.readdir(folderPath)) {

        const qualityFolderPath = path.join(folderPath, qualityFolder);
        const stats = await fs.stat(qualityFolderPath);
        if (stats.isDirectory()) {

            //console.log('Language:', qualityFolder);

            results[qualityFolder] = {};

            for (const file of await fs.readdir(qualityFolderPath)) {
                const filePath = path.join(qualityFolderPath, file);
                const stats = await fs.stat(filePath);
                if (stats.isFile()) {
                    if (file.endsWith('.m3u8')) {
                        continue;
                    }

                    //console.log('File:', file);

                    const hash = await calculateBlake2bHash(filePath);
                    results[qualityFolder][file] = {
                        hash: hash,
                        size: stats.size
                    };
                }
            }
        }
    }

    return results;
}

// API endpoint to calculate hash of files in a folder
app.get('/hash/:id(*)', async (req, res) => {
    try {
        if (!req.params.id) {
            return res.status(400).json({ error: 'ID is required' });
        }

        const folderPath = path.join(BASE_DIR, req.params.id, "hls");

        // Check if the path exists and is a directory
        try {
            const stats = await fs.stat(folderPath);
        } catch (error) {
            return res.status(404).json({ error: 'ID not found' });
        }

        const results = {};

        for (const folder of await fs.readdir(folderPath)) {
            const subFolderPath = path.join(folderPath, folder);
            const stats = await fs.stat(subFolderPath);
            if (stats.isDirectory()) {
                //console.log('Directory:', folder);

                results[folder] = {};

                if (folder === 'audio') {
                    results[folder] = await handleAudios(subFolderPath);
                } else if (folder === 'subtitle') {
                    results[folder] = await handleSubtitles(subFolderPath);
                } else if (folder === 'video') {
                    results[folder] = await handleVideos(subFolderPath);
                }
            }
        }


        // Process the results and create media track records
        const mediaId = req.params.id;

        // Process each media type (audio, subtitle, video)
        for (const type of Object.keys(results)) {
            // Delete existing media tracks for this mediaId and type
            try {
            await deleteMediaTrackByType(mediaId, type);
            //console.log(`Deleted existing media tracks for ${type}`);
            } catch (err) {
            console.error(`Failed to delete existing media tracks for ${type}:`, err);
            throw err;
            }

            // For each language or quality folder
            for (const language of Object.keys(results[type])) {

            // Create media track record
            const mediaTrackData = {
                mediaId: mediaId,
                type: type,
                language: language,
                status: 'PROCESSING'
            };

            try {
                const trackId = await createMediaTrack(mediaTrackData);
                //console.log(`Created media track: ${type}, ${language}, ${file}`);
                // For each file in that language/quality
                for (const file of Object.keys(results[type][language])) {
                const info = results[type][language][file];

                // Create fragment record
                const fragmentData = {
                    trackId: trackId,
                    hash: info.hash,
                    nodes: 0,
                    status: 'COMPLETED',
                    size: info.size,
                    file_name: file
                };

                try {
                    await createFragment(fragmentData);
                    //console.log(`Created fragment: ${type}, ${language}, ${file}`);
                }
                catch (err) {
                    console.error(`Failed to create fragment for ${type}:`, err);
                    await updateMediaTrack(trackId, { status: 'ERROR - ' + err.message });
                    throw err;
                }
                }

                try {
                // Calculate total fragments (number of files for this track)
                const totalFragments = Object.keys(results[type][language]).length;
                await updateMediaTrack(trackId, { total_fragments: totalFragments, status: 'COMPLETED' });
                } catch (err) {
                console.error(`Failed to update media track status:`, err);
                throw err;
                }
            } catch (err) {
                console.error(`Failed to create media track for ${type}:`, err);
                throw err;
            }
            }
        }

        res.json(results);
        // const files = await fs.readdir(folderPath);
        // const results = {};

        // for (const file of files) {
        //     const filePath = path.join(folderPath, file);
        //     const stats = await fs.stat(filePath);

        //     if (stats.isFile()) {
        //         const hash = await calculateBlake2bHash(filePath);
        //         results[file] = hash;
        //     }
        // }

        // res.json(results);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Example usage: http://localhost:${port}/hash/path/to/folder`);
});