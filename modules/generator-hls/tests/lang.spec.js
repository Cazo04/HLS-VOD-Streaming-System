const { getLanguageInfo } = require('../src/app');

describe('getLanguageInfo', () => {
  it('trả về mã ISO khi returnFullName = false', () => {
    expect(getLanguageInfo('eng', false)).toBe('en');
  });

  it('trả về tên đầy đủ khi returnFullName = true', () => {
    expect(getLanguageInfo('eng', true)).toBe('English');
  });

  it('ném lỗi với mã không hỗ trợ', () => {
    expect(() => getLanguageInfo('xxx')).toThrow('Unknown abbreviation');
  });
});