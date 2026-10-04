import { describe, expect, it } from 'vitest';
import { nameKey } from './names';

describe('nameKey', () => {
  it('ignores case, including letters outside A–Z', () => {
    expect(nameKey('TONI')).toBe(nameKey('toni'));
    expect(nameKey('Äiti')).toBe(nameKey('äiti'));
    expect(nameKey('ÖRJAN')).toBe(nameKey('örjan'));
  });

  it('treats composed and decomposed spellings of a letter as the same', () => {
    expect(nameKey('Äiti')).toBe(nameKey('Äiti'));
  });

  it('folds compatibility forms such as full-width letters', () => {
    expect(nameKey('ＴＯＮＩ')).toBe(nameKey('toni'));
  });

  it('collapses runs of whitespace and trims the ends', () => {
    expect(nameKey('  Toni   S\t ')).toBe(nameKey('Toni S'));
  });

  it('ignores invisible format characters such as zero-width spaces and soft hyphens', () => {
    expect(nameKey('To​ni')).toBe(nameKey('Toni'));
    expect(nameKey('To­ni')).toBe(nameKey('Toni'));
  });

  it('keeps names that differ in letters apart', () => {
    expect(nameKey('Ada')).not.toBe(nameKey('Ida'));
    expect(nameKey('Toni S')).not.toBe(nameKey('ToniS'));
  });
});
