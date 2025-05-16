const express = require('express');
const busboy = require('busboy');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { v7: uuidv7 } = require('uuid');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

const baseDir = process.env.BASE_DIR || __dirname;
const uploadsDir = path.join(baseDir, 'uploads');
const completedDir = path.join(baseDir, 'completed');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(completedDir)) fs.mkdirSync(completedDir);

async function createMedia(mediaData) {
  const { id, title } = mediaData;
  const createdAt = new Date();
  const updatedAt = new Date();
  const status = 'SAVED';

  const sql = `
    INSERT INTO Media (id, title, created_at, updated_at, status)
    VALUES (?, ?, ?, ?, ?)
  `;
  const values = [id, title, createdAt, updatedAt, status];

  await pool.query(sql, values);
  return { id, ...mediaData };
}

async function updateMedia(mediaData) {
  const { id, title } = mediaData;
  const updatedAt = new Date();

  const sql = `
    UPDATE Media SET title = ?, updated_at = ?
    WHERE id = ?
  `;
  const values = [title, updatedAt, id];

  await pool.query(sql, values);
  return { id, ...mediaData };
}

function handleUpload(uploadId, uploadFolder, req, res, isUpdate = false) {
  const bb = busboy({ headers: req.headers });

  let isFileReceived = false;

  let fileProcessed = false; // Track if we've already processed a file

  bb.on('file', (fieldname, fileStream, info) => {
    // If we already processed a file, ignore additional files
    if (fileProcessed) {
      console.log(`(UploadID: ${uploadId}) Skipping file: ${info.filename} (Only 1 file allowed)`);
      fileStream.resume(); // Consume the stream without saving
      return;
    }

    fileProcessed = true;
    isFileReceived = true;
    const { filename } = info;
    console.log(`(UploadID: ${uploadId}) Received file: ${filename}`);

    const savePath = path.join(uploadFolder, filename);
    const writeStream = fs.createWriteStream(savePath);

    fileStream.pipe(writeStream);

    fileStream.on('data', (chunk) => {
      //if (chunk.length == 1) console.log(`(UploadID: ${uploadId}) Received additional ${chunk.length} bytes`);
    });

    fileStream.on('end', () => {
      console.log(`(UploadID: ${uploadId}) File completed: ${filename}`);
    });
  });

  bb.on('finish', () => {

    console.log(`(UploadID: ${uploadId}) All files have been processed!`);

    if (!isFileReceived) {

      fs.rmdirSync(uploadFolder, { recursive: true });
      return res.status(400).send('No upload file found!');
    }

    setTimeout(() => {
      const completedPath = path.join(completedDir, uploadId);
      // Create the destination directory if it doesn't exist
      if (!fs.existsSync(completedPath)) {
        fs.mkdirSync(completedPath);
      }

      // Move each file from upload folder to completed folder
      fs.readdir(uploadFolder, (err, files) => {
        if (err) {
          console.error('Error reading directory:', err);
          return res.status(500).send('Upload successful, but unable to read directory');
        }

        let moveErrors = 0;
        let filesProcessed = 0;

        if (files.length === 0) {
          // Clean up empty upload folder
          fs.rmdirSync(uploadFolder);
          return res.status(200).send({
            message: 'Upload successful!',
            uploadId: uploadId,
          });
        }

        const file = files[0];
        const sourcePath = path.join(uploadFolder, file);
        const destPath = path.join(completedPath, file);

        fs.rename(sourcePath, destPath, err => {
          if (err) {
            console.error(`Error moving file ${file}:`, err);
            return res.status(500).send('Upload successful, but file could not be moved');
          }

          // Clean up upload folder after moving the first file
          fs.rmdirSync(uploadFolder);

          if (isUpdate) {
            // Update the media record in the database
            const mediaData = { id: uploadId, title: file.replace(/\.[^/.]+$/, '') };
            updateMedia(mediaData).then(media => {
              return res.status(200).send({
                message: 'Upload successful! (Updated)',
                uploadId: uploadId,
                file: file
              });
            });
          } else {
            // Create a new media record in the database
            const mediaData = { id: uploadId, title: file.replace(/\.[^/.]+$/, '') };
            createMedia(mediaData).then(media => {
              return res.status(200).send({
                message: 'Upload successful!',
                uploadId: uploadId,
                file: file
              });
            });
          }

        });
      });
    }, 200);
  });

  req.on('close', () => {
    // console.log(`(UploadID: ${uploadId}) Connection closed before completion`);
    // cleanupFolder(uploadFolder);
  });

  req.on('aborted', () => {
    console.log(`(UploadID: ${uploadId}) Connection aborted (interrupted)`);
    cleanupFolder(uploadFolder);
  });

  req.pipe(bb);
}

app.post('/api/upload', (req, res) => {

  let uploadId = uuidv7();

  let uploadFolder = path.join(uploadsDir, uploadId);
  let completedPath = path.join(completedDir, uploadId);

  while ((fs.existsSync(completedPath) || fs.existsSync(uploadFolder)) && fs.readdirSync(uploadFolder).length > 0) {
    uploadId = uuidv7();
    uploadFolder = path.join(uploadsDir, uploadId);
    completedPath = path.join(completedDir, uploadId);
  }

  if (!fs.existsSync(uploadFolder)) {
    fs.mkdirSync(uploadFolder);
  }

  handleUpload(uploadId, uploadFolder, req, res);

});

app.post('/api/upload/:uploadId', (req, res) => {
  const { uploadId } = req.params;
  const uploadFolder = path.join(uploadsDir, uploadId);
  const completedPath = path.join(completedDir, uploadId);

  if (!fs.existsSync(completedPath)) {
    return res.status(404).send('Upload ID does not exist');
  }

  // Remove all existing files in the directory
  for (const file of fs.readdirSync(completedPath)) {
    const filePath = path.join(completedPath, file);

    if (fs.lstatSync(filePath).isFile()) {
      fs.unlinkSync(filePath);

      console.log(`(UploadID: ${uploadId}) Deleted file: ${file}`);
    }
  }

  fs.mkdirSync(uploadFolder);

  handleUpload(uploadId, uploadFolder, req, res, true);
});

function cleanupFolder(folderPath) {
  if (fs.existsSync(folderPath)) {
    fs.rmSync(folderPath, { recursive: true, force: true });
    console.log(`Deleted temporary folder: ${folderPath}`);
  }
}

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
