const express = require('express');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const axios = require('axios');
const pool = require('./db');

const HLS_TIME = 5;
const BASE_DIR = process.env.BASE_DIR || path.join(__dirname, 'completed');
const HASH_SERVICE_URL = process.env.HASH_SERVICE_URL || 'http://localhost:3000/hash/';

const languageMap = {
    eng: ["en", "English"],
    vie: ["vi", "Vietnamese"],
    fra: ["fr", "French"],
    fre: ["fr", "French"],
    deu: ["de", "German"],
    ger: ["de", "German"],
    spa: ["es", "Spanish"],
    ita: ["it", "Italian"],
    rus: ["ru", "Russian"],
    por: ["pt", "Portuguese"],
    chi: ["zh", "Chinese"],
    zho: ["zh", "Chinese"],
    jpn: ["ja", "Japanese"],
    kor: ["ko", "Korean"],
    ara: ["ar", "Arabic"],
    hin: ["hi", "Hindi"],
    tha: ["th", "Thai"],
    tur: ["tr", "Turkish"],
    nld: ["nl", "Dutch"],
    dut: ["nl", "Dutch"],
    swe: ["sv", "Swedish"],
    nor: ["no", "Norwegian"],
    dan: ["da", "Danish"],
    fin: ["fi", "Finnish"],
    pol: ["pl", "Polish"],
    ukr: ["uk", "Ukrainian"],
    gre: ["el", "Greek"],
    ell: ["el", "Greek"],
    hun: ["hu", "Hungarian"],
    heb: ["he", "Hebrew"],
    ces: ["cs", "Czech"],
    bul: ["bg", "Bulgarian"],
    ron: ["ro", "Romanian"],
    srp: ["sr", "Serbian"],
    hrv: ["hr", "Croatian"],
    slk: ["sk", "Slovak"],
    slv: ["sl", "Slovenian"],
    lit: ["lt", "Lithuanian"],
    lav: ["lv", "Latvian"],
    est: ["et", "Estonian"],
    ind: ["id", "Indonesian"],
    mal: ["ms", "Malay"],
    msa: ["ms", "Malay"],
    tam: ["ta", "Tamil"],
    urd: ["ur", "Urdu"],
    per: ["fa", "Persian"],
    ben: ["bn", "Bengali"],
    afr: ["af", "Afrikaans"],
    fil: ["tl", "Filipino"],
    nep: ["ne", "Nepali"],
    guj: ["gu", "Gujarati"],
    mar: ["mr", "Marathi"],
    kan: ["kn", "Kannada"],
    tel: ["te", "Telugu"],
    mlm: ["ml", "Malayalam"],
    mal: ["ml", "Malayalam"],
    amh: ["am", "Amharic"],
    swa: ["sw", "Swahili"],
    geo: ["ka", "Georgian"],
    kat: ["ka", "Georgian"],
    kaz: ["kk", "Kazakh"],
    uzb: ["uz", "Uzbek"],
    mon: ["mn", "Mongolian"],
    sin: ["si", "Sinhala"],
    mya: ["my", "Burmese"],
    khm: ["km", "Khmer"],
    lao: ["lo", "Lao"],
    tib: ["bo", "Tibetan"],
    bod: ["bo", "Tibetan"],
    pus: ["ps", "Pashto"],
    snd: ["sd", "Sindhi"],
    asm: ["as", "Assamese"],
};

function getLanguageInfo(abbr, returnFullName) {
    if (languageMap.hasOwnProperty(abbr)) {
        return returnFullName ? languageMap[abbr][1] : languageMap[abbr][0];
    }
    throw new Error("Unknown abbreviation: " + abbr);
}

async function updateMedia(id, status) {
    const updatedAt = new Date();

    const sql = `
        UPDATE Media SET status = ?, updated_at = ?
        WHERE id = ?
    `;
    const values = [status, updatedAt, id];

    await pool.query(sql, values);
}

async function updateMediaInfo(mediaData) {
    const { id, status, duration, resolution } = mediaData;
    const updatedAt = new Date();

    const sql = `
        UPDATE Media SET status = ?, duration = ?, resolution = ?, updated_at = ?
        WHERE id = ?
    `;
    const values = [status, duration, resolution, updatedAt, id];

    await pool.query(sql, values);
}

/**
 * Asynchronous ffprobe function using fluent-ffmpeg
 * Returns metadata containing information about streams, format, etc.
 */
function ffprobeAsync(filePath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) return reject(err);
            resolve(metadata);
        });
    });
}

// Modified runFFmpegAsync to track commands for cancellation
function runFFmpegAsync(filePath, outputPath, outputOptions, id) {
    return new Promise((resolve, reject) => {
        const command = ffmpeg(filePath);

        // If outputOptions array exists, add it
        if (Array.isArray(outputOptions)) {
            command.outputOptions(outputOptions);
        }

        // If outputPath exists, specify output
        if (outputPath) {
            command.output(outputPath);
        }

        // Store the command if an ID is provided
        if (id && ffmpegCommands[id]) {
            ffmpegCommands[id].push(command);
        }

        command
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
            .on('progress', (progress) => {
                if (progress.percent) {
                    console.log(`Processing: ${Math.floor(progress.percent)}% done`);
                }
            })
            .on('end', () => {
                console.log('FFmpeg has finished.');
            })
            .run();
    });
}

/**
 * Create segments for Subtitle (WebVTT) from filePath
 */
async function generateSubtitleLocal(filePath, tempDir, id) {
    const subtitleMetadata = await ffprobeAsync(filePath);
    const subtitleStreams = subtitleMetadata.streams.filter(s => s.codec_type === 'subtitle');

    const tempDirSubtitle = path.join(tempDir, 'subtitle');
    if (fs.existsSync(tempDirSubtitle)) {
        fs.rmSync(tempDirSubtitle, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDirSubtitle, { recursive: true });

    for (const stream of subtitleStreams) {
        const index = stream.index;
        let language = "und-" + index;
        if (stream.tags && stream.tags.language) {
            language = stream.tags.language;
        }
        const outputDir = path.join(tempDirSubtitle, language);
        fs.mkdirSync(outputDir, { recursive: true });

        // Create webvtt segment
        // Equivalent to: ffmpeg -i filePath -map 0:${index} -vn -an -f segment -segment_time 3 ...
        await runFFmpegAsync(
            filePath,
            path.join(outputDir, 'output%03d.vtt'),
            [
                `-map 0:${index}`,
                '-vn',
                '-an',
                '-f segment',
                '-segment_time 3',
                '-segment_format webvtt',
                `-segment_list ${path.join(outputDir, 'output.m3u8')}`
            ],
            id
        );
    }
}

/**
 * Create thumbnail in a "mosaic" (tile) pattern
 */
async function generateThumbnail(filePath, tempDir) {
    const thumbnailsDir = path.join(tempDir, 'thumbnails');
    if (fs.existsSync(thumbnailsDir)) {
        fs.rmSync(thumbnailsDir, { recursive: true, force: true });
    }
    fs.mkdirSync(thumbnailsDir, { recursive: true });

    const w = 178;
    const h = 100;
    const c = 5; // number of columns
    const r = 5; // number of rows

    // Create tiled image
    // Equivalent to: ffmpeg -i input -vf fps=1,scale=178:100,tile=5x5 -vsync vfr -qscale:v 2 -an output%05d.jpg
    await runFFmpegAsync(
        filePath,
        path.join(thumbnailsDir, 'output%05d.jpg'),
        [
            `-vf fps=1,scale=${w}:${h},tile=${c}x${r}`,
            '-vsync vfr',
            '-qscale:v 2',
            '-an'
        ]
    );

    // Get duration
    const videoMetadata = await ffprobeAsync(filePath);
    const duration = videoMetadata.format.duration || 0;

    let counter = 0;
    let thumbsvtt = "WEBVTT\n\n";

    function formatTime(sec) {
        let ms = Math.floor((sec - Math.floor(sec)) * 1000);
        let s = Math.floor(sec) % 60;
        let m = Math.floor(Math.floor(sec) / 60) % 60;
        let h = Math.floor(Math.floor(sec) / 3600);

        const hh = h.toString().padStart(2, '0');
        const mm = m.toString().padStart(2, '0');
        const ss = s.toString().padStart(2, '0');
        const mss = ms.toString().padStart(3, '0');
        return `${hh}:${mm}:${ss}.${mss}`;
    }

    // Read list of .jpg files
    const files = fs.readdirSync(thumbnailsDir).filter(f => f.endsWith('.jpg'));
    for (const file of files) {
        for (let i = 0; i < r; i++) {
            for (let j = 0; j < c; j++) {
                const start = counter;
                if (start > duration) break;

                let end = counter + 1;
                if (end > duration) {
                    end = duration;
                }
                counter++;

                thumbsvtt += `${counter}\n`;
                thumbsvtt += `${formatTime(start)} --> ${formatTime(end)}\n`;
                thumbsvtt += `${file}#xywh=${j * w},${i * h},${w},${h}\n\n`;
            }
        }
    }

    fs.writeFileSync(path.join(thumbnailsDir, "output-thumbs.vtt"), thumbsvtt, 'utf-8');
}

/**
 * Function to re-render video to H.264 + convert to HLS
 */
async function rerender(filePath, tempDir, id) {
    const tempDirVideo = path.join(tempDir, 'video');
    if (fs.existsSync(tempDirVideo)) {
        fs.rmSync(tempDirVideo, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDirVideo);

    const videoProbe = await ffprobeAsync(filePath);
    const videoStreams = videoProbe.streams.filter(s => s.codec_type === 'video');
    const resolution = videoStreams[0].width + 'x' + videoStreams[0].height;
    const videoBitrate = calculateStreamBitrate(videoStreams[0]);
    const framerate = videoStreams[0].avg_frame_rate || videoStreams[0].r_frame_rate;
    const videoFrameRate = Math.ceil(framerate.split('/')[0] / framerate.split('/')[1]);

    await updateMediaInfo({
        id,
        status: 'PROCESSING - Video',
        duration: parseInt(videoProbe.format.duration || 0, 10),
        resolution: resolution
    });

    const outputDir = path.join(tempDirVideo, resolution + "-" + videoFrameRate + "-" + videoBitrate);
    fs.mkdirSync(outputDir);

    const outputMp4 = path.join(outputDir, 'output.mp4');

    // Step 1: re-encode to mp4
    await runFFmpegAsync(
        filePath,
        outputMp4,
        [
            '-an',                // remove audio
            '-c:v libx264',
            '-preset slow'
        ],
        id
    );

    // Step 2: convert MP4 to HLS
    await runFFmpegAsync(
        outputMp4,
        path.join(outputDir, 'output.m3u8'),
        [
            '-preset slow',
            `-hls_time ${HLS_TIME}`,
            '-hls_playlist_type vod',
            '-hls_flags independent_segments',
            '-force_key_frames expr:gte(t,n_forced*1)',
            '-f hls',
            '-muxdelay 0'
        ],
        id
    );

    fs.unlinkSync(outputMp4);
}

async function generateAudio(filePath, tempDir, id) {
    const metadata = await ffprobeAsync(filePath);
    const audioStreams = metadata.streams.filter(s => s.codec_type === 'audio');

    const tempDirAudio = path.join(tempDir, 'audio');
    if (fs.existsSync(tempDirAudio)) {
        fs.rmSync(tempDirAudio, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDirAudio);

    for (const stream of audioStreams) {
        const index = stream.index;
        let language = "und-" + index;
        if (stream.tags && stream.tags.language) {
            language = stream.tags.language;
        }
        const outputDir = path.join(tempDirAudio, language);
        fs.mkdirSync(outputDir);

        const aacPath = path.join(outputDir, `${language}.aac`);

        await runFFmpegAsync(
            filePath,
            aacPath,
            [
                `-map 0:${index}`,
                '-vn',
                '-c:a aac'
            ],
            id
        );

        await runFFmpegAsync(
            aacPath,
            path.join(outputDir, 'output.m3u8'),
            [
                '-preset slow',
                `-hls_time ${HLS_TIME}`,
                '-hls_playlist_type vod',
                '-hls_flags independent_segments',
                '-force_key_frames expr:gte(t,n_forced*1)',
                '-f hls',
                '-muxdelay 0'
            ],
            id
        );

        fs.unlinkSync(aacPath);
    }
}

async function generateMasterHlsLocal(tempDir) {
    let masterPlaylist = "#EXTM3U\n";
    masterPlaylist += "#EXT-X-VERSION:3\n";

    const dirs = fs.readdirSync(tempDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

    let isFirstAudio = true;
    let isFirstSubtitle = true;

    for (const d of dirs) {
        const fullPath = path.join(tempDir, d);

        if (d === 'audio') {
            // Get each audio subdirectory
            const audioDirs = fs.readdirSync(fullPath, { withFileTypes: true })
                .filter(dd => dd.isDirectory())
                .map(dd => dd.name);
            for (const audioName of audioDirs) {
                const audioPath = path.join('audio', audioName, 'output.m3u8');
                let displayName, langAttr = '';
                if (audioName.includes('-')) {
                    // example "und-2"
                    displayName = audioName;
                } else {
                    displayName = getLanguageInfo(audioName, true);
                    langAttr = `LANGUAGE="${getLanguageInfo(audioName, false)}",`;
                }

                masterPlaylist += `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="${displayName}",${isFirstAudio ? "DEFAULT=YES," : ""}${langAttr}AUTOSELECT=YES,URI="${audioPath}"\n`;
                isFirstAudio = false;
            }
        } else if (d === 'subtitle') {
            // Get each subtitle subdirectory
            const subDirs = fs.readdirSync(fullPath, { withFileTypes: true })
                .filter(dd => dd.isDirectory())
                .map(dd => dd.name);
            for (const subtitleName of subDirs) {
                const subtitlePath = path.join('subtitle', subtitleName, 'output.m3u8');
                let displayName, langAttr = '';
                if (subtitleName.includes('-')) {
                    displayName = subtitleName;
                } else {
                    displayName = getLanguageInfo(subtitleName, true);
                    langAttr = `LANGUAGE="${getLanguageInfo(subtitleName, false)}",`;
                }
                masterPlaylist += `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subtitle",NAME="${displayName}",${isFirstSubtitle ? "DEFAULT=YES," : ""}${langAttr}AUTOSELECT=YES,URI="${subtitlePath}"\n`;
                isFirstSubtitle = false;
            }
        } else if (d === 'video' || d === 'thumbnails') {
            // Process video
            if (d === 'video') {
                const videoSubDirs = fs.readdirSync(fullPath, { withFileTypes: true })
                    .filter(dd => dd.isDirectory())
                    .map(dd => dd.name);
                for (const videoResDir of videoSubDirs) {
                    const resolutionPath = path.join(fullPath, videoResDir);
                    const m3u8Files = fs.readdirSync(resolutionPath)
                        .filter(f => f.endsWith('.m3u8'));

                    const videoValue = videoResDir.split('-');
                    const resolutionPart = videoValue[0];
                    const framerate = videoValue[1];
                    const bandwidth = videoValue[2];

                    for (const m3u8 of m3u8Files) {
                        masterPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},NAME="${resolutionPart + "-" + framerate}",RESOLUTION="${resolutionPart}"\n`;
                        masterPlaylist += `video/${videoResDir}/${m3u8}\n`;
                    }
                }
            }
        }
    }

    // Write file
    const masterFilePath = path.join(tempDir, 'master.m3u8');
    fs.writeFileSync(masterFilePath, masterPlaylist, 'utf-8');
}

function calculateStreamBitrate(streamData) {
    if (!streamData) return 0;

    // Return actual bitrate if available
    if (streamData.bit_rate && streamData.bit_rate !== "N/A") {
        const bitrate = parseInt(streamData.bit_rate, 10);
        return isNaN(bitrate) ? 0 : bitrate;
    }

    // Handle different stream types
    switch (streamData.codec_type) {
        case 'video':
            return calculateVideoBitrate(streamData);
        case 'audio':
            return calculateAudioBitrate(streamData);
        case 'subtitle':
            return 1000; // Default small bitrate for subtitles
        default:
            console.warn(`Unknown codec type: ${streamData.codec_type || 'undefined'}`);
            return 5000000; // Safe default of 5 Mbps
    }
}

function calculateVideoBitrate(streamData) {
    // Validate required properties
    if (!streamData.width || !streamData.height) {
        console.warn('Missing video dimensions');
        return 5000000; // Safe default of 5 Mbps
    }

    // Extract frame rate with multiple fallbacks
    let frameRate = 30; // Default to 30fps if nothing available
    try {
        let frameRateStr = (streamData.avg_frame_rate && streamData.avg_frame_rate !== "N/A")
            ? streamData.avg_frame_rate
            : streamData.r_frame_rate || '30/1';

        if (frameRateStr.includes('/')) {
            const [num, den] = frameRateStr.split('/').map(Number);
            frameRate = den !== 0 ? num / den : 30;
        } else {
            frameRate = parseFloat(frameRateStr) || 30;
        }

        // Sanity check
        if (frameRate <= 0 || frameRate > 300) frameRate = 30;
    } catch (e) {
        console.warn('Error calculating frame rate:', e.message);
    }

    // Comprehensive pixel format factors (bits per pixel)
    const pixFmtFactors = {
        // YUV formats
        'yuv420p': 1.5, 'yuvj420p': 1.5, 'yuv420p10le': 1.875,
        'yuv422p': 2, 'yuvj422p': 2, 'yuv422p10le': 2.5,
        'yuv444p': 3, 'yuvj444p': 3, 'yuv444p10le': 3.75,
        // RGB formats
        'rgb24': 3, 'rgba': 4, 'rgb48be': 6,
        // Other common formats
        'gbrap': 4, 'gbrp': 3, 'gray': 1
    };

    // Get bits per sample with fallbacks
    let bitsPerSample = 8; // Default to 8-bit
    if (streamData.bits_per_raw_sample && streamData.bits_per_raw_sample !== "N/A") {
        bitsPerSample = parseInt(streamData.bits_per_raw_sample, 10);
        if (isNaN(bitsPerSample) || bitsPerSample <= 0) bitsPerSample = 8;
    } else if (streamData.pix_fmt && streamData.pix_fmt.includes('10')) {
        bitsPerSample = 10;
    } else if (streamData.pix_fmt && streamData.pix_fmt.includes('12')) {
        bitsPerSample = 12;
    }

    // Get pixel format factor with fallback
    const factor = (streamData.pix_fmt && pixFmtFactors[streamData.pix_fmt]) || 1.5;

    // Calculate bits per frame
    const width = parseInt(streamData.width, 10) || 1920;
    const height = parseInt(streamData.height, 10) || 1080;
    const bitsPerFrame = width * height * factor * bitsPerSample;

    // Calculate raw bitrate and apply compression factor
    const rawBitrate = bitsPerFrame * frameRate;
    // Assume a typical compression efficiency (0.1 means 10x compression)
    const compressionFactor = 0.1;

    return Math.max(100000, Math.round(rawBitrate * compressionFactor));
}

function calculateAudioBitrate(streamData) {
    try {
        const sampleRate = parseInt(streamData.sample_rate, 10) || 44100;
        const channels = parseInt(streamData.channels, 10) || 2;
        let bitsPerSample = 16; // Default to 16-bit

        if (streamData.bits_per_raw_sample && streamData.bits_per_raw_sample !== "N/A") {
            bitsPerSample = parseInt(streamData.bits_per_raw_sample, 10);
            if (isNaN(bitsPerSample) || bitsPerSample <= 0) bitsPerSample = 16;
        }

        // Apply compression factor based on codec
        let compressionFactor = 0.1; // Default compression
        if (streamData.codec_name) {
            const codec = streamData.codec_name.toLowerCase();
            if (codec.includes('flac')) compressionFactor = 0.7;
            else if (codec.includes('mp3')) compressionFactor = 0.1;
            else if (codec.includes('aac')) compressionFactor = 0.1;
            else if (codec.includes('opus')) compressionFactor = 0.05;
        }

        const rawBitrate = sampleRate * channels * bitsPerSample;
        return Math.max(32000, Math.round(rawBitrate * compressionFactor));
    } catch (e) {
        console.warn('Error calculating audio bitrate:', e.message);
        return 128000; // Default to 128 kbps
    }
}

function callHashService(id) {
    return new Promise((resolve, reject) => {
        const url = HASH_SERVICE_URL + id;
        axios.get(url)
            .then(response => resolve(response.data))
            .catch(error => reject(error));
    });
}

const app = express();
app.use(express.json());

// Track which IDs are currently being processed
const processingIds = new Set();
// Store ffmpeg commands for each ID to be able to cancel them
const ffmpegCommands = {};

app.get('/hls/:id', async (req, res) => {
    const id = req.params.id;

    // Get query parameters with defaults
    const video = req.query.video !== 'false';
    const audio = req.query.audio !== 'false';
    const subtitle = req.query.subtitle !== 'false';
    const thumbnails = req.query.thumbnails !== 'false';

    if (!id) {
        return res.status(400).json({ error: "ID is required" });
    }

    // Check if this ID is already being processed
    if (processingIds.has(id)) {
        return res.status(409).json({ error: "This ID is already being processed" });
    }

    const fullFolderPath = path.join(BASE_DIR, id);

    if (!fs.existsSync(fullFolderPath)) {
        return res.status(404).json({ error: "Folder not found" });
    }

    let filePath = null;

    for (const file of fs.readdirSync(fullFolderPath)) {
        const tempFilePath = path.join(fullFolderPath, file);
        if (fs.statSync(tempFilePath).isDirectory()) {
            continue;
        }

        if (file.endsWith('.mp4') || file.endsWith('.mkv') || file.endsWith('.avi')) {
            filePath = tempFilePath;
            break;
        }
    }

    // Mark this ID as being processed
    processingIds.add(id);
    ffmpegCommands[id] = [];

    res.status(202).json({ message: "Request received, server will process in the background." });

    (async () => {
        try {
            const tempDir = path.join(path.dirname(filePath), 'hls');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir);
            }

            if (subtitle) {
                await updateMedia(id, 'PROCESSING - Subtitle');
                await generateSubtitleLocal(filePath, tempDir, id);
            }

            if (audio) {
                await updateMedia(id, 'PROCESSING - Audio');
                await generateAudio(filePath, tempDir, id);
            }

            if (thumbnails) {
                await updateMedia(id, 'PROCESSING - Thumbnails');
                await generateThumbnail(filePath, tempDir);
            }

            if (video) {
                await rerender(filePath, tempDir, id);
            }

            await updateMedia(id, 'PROCESSING - Master Playlist');
            await generateMasterHlsLocal(tempDir);

            console.log("Background processing completed for file:", filePath);

            // Update the media status to "PROCESSED"
            await updateMedia(id, 'PROCESSED');

            // Call hash service to update the hash
            callHashService(id)
                .then(() => console.log("Hash service updated"))
                .catch(err => console.error("Error updating hash service:", err));
        } catch (err) {
            console.error("Error during background processing:", err);
            await updateMedia(id, 'ERROR - ' + err.message);
        } finally {
            // Always clean up, even if there was an error
            processingIds.delete(id);
            delete ffmpegCommands[id];
        }
    })();
});

// New endpoint to cancel processing for an ID
app.delete('/hls/:id', (req, res) => {
    const id = req.params.id;

    if (!id) {
        return res.status(400).json({ error: "ID is required" });
    }

    if (!processingIds.has(id)) {
        return res.status(404).json({ error: "No processing found for this ID" });
    }

    // Cancel all ffmpeg commands for this ID
    if (ffmpegCommands[id] && ffmpegCommands[id].length > 0) {
        ffmpegCommands[id].forEach(cmd => {
            try {
                cmd.kill('SIGKILL');
            } catch (err) {
                console.error("Error killing ffmpeg process:", err);
            }
        });
    }

    // Mark as no longer processing
    processingIds.delete(id);
    delete ffmpegCommands[id];

    return res.status(200).json({ message: "Processing cancelled for ID: " + id });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is listening on port ${PORT}...`);
});
