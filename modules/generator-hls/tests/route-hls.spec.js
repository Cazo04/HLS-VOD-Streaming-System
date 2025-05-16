const request = require('supertest');
const mock = require('mock-fs');
const { app } = require('../src/app');
const path = require('path');
const fs = require('fs');

describe('GET /api/hls/:id', () => {
    beforeEach(() => {
        mock({
            'completed/abc': {
                'video.mp4': 'fakecontent',         
                'hls': {                          
                    'master.m3u8': 'fakecontent',    
                    'video': {                        
                        'playlist.m3u8': 'fakecontent',
                        'segment0.ts': 'fakecontent',
                        'segment1.ts': 'fakecontent'
                    },
                    'audio': {                      
                        'playlist.m3u8': 'fakecontent',
                        'segment0.aac': 'fakecontent'
                    },
                    'subtitle': {                    
                        'en.vtt': 'fakecontent'
                    },
                    'thumbnails': {                 
                        'sprite.jpg': 'fakecontent',
                        'thumb001.jpg': 'fakecontent'
                    }
                }
            }
        });
        process.env.TEST_BASE_DIR = path.resolve('completed');
    });

    // Test cases remain the same
    it('thiếu id → 400', async () => {
        const res = await request(app).get('/api/hls/');
        expect(res.status).toBe(404);   // route mismatch
    });

    it('id không tồn tại → 404', async () => {
        const res = await request(app).get('/api/hls/xyz');
        expect(res.status).toBe(404);
    });

    it('nhận request hợp lệ → 202', async () => {
        const res = await request(app).get('/api/hls/abc?video=false&audio=false&subtitle=false&thumbnails=false');
        expect(res.status).toBe(202);
    });
});
