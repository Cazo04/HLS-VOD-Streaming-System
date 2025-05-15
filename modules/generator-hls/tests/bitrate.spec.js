const { calculateStreamBitrate } = require('../src/app');

describe('calculateStreamBitrate(video)', () => {
  it('tính bitrate đúng cho video HD 30fps', () => {
    const fakeStream = {
      codec_type: 'video',
      width: 1280, height: 720,
      avg_frame_rate: '30/1',
      pix_fmt: 'yuv420p', bits_per_raw_sample: '8'
    };
    const br = calculateStreamBitrate(fakeStream);
    expect(br).toBeGreaterThan(500_000);
    expect(br).toBeLessThan(50_000_000);
  });
});