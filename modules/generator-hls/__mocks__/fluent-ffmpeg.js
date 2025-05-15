const EventEmitter = require('events');
module.exports = jest.fn(() => {
  const ee = new EventEmitter();
  return {
    output: jest.fn().mockReturnThis(),
    outputOptions: jest.fn().mockReturnThis(),
    on: ee.on.bind(ee),
    run: () => setImmediate(() => ee.emit('end')),
    kill: jest.fn()
  };
});
module.exports.ffprobe = jest.fn((p, cb) =>
  cb(null, { streams: [], format: { duration: 0 } })
);
