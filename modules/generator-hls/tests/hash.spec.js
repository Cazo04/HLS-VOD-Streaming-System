const nock = require('nock');
const { callHashService } = require('../src/app');

describe('callHashService', () => {
  it('request thành công', async () => {
    nock('http://localhost:3000').get('/hash/123').reply(200, { ok: true });
    await expect(callHashService(123)).resolves.toEqual({ ok: true });
  });
});