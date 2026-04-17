import { describe, it, expect } from 'vitest';
import { resolveI2iBaseImage } from '../api/v2-asset-helpers';

const completed = 'completed';
const idle = 'idle';
const generating = 'generating';

describe('resolveI2iBaseImage', () => {
  const siblings = [
    {
      slug: 'char-main',
      is_main: true,
      image_url: 'https://img/main.jpg',
      image_gen_status: completed,
    },
    {
      slug: 'char-variant-a',
      is_main: false,
      image_url: 'https://img/a.jpg',
      image_gen_status: completed,
    },
    {
      slug: 'char-variant-b',
      is_main: false,
      image_url: null,
      image_gen_status: idle,
    },
  ];

  it('uses reference variant image when slug matches and image is completed', () => {
    const result = resolveI2iBaseImage('char-variant-a', siblings);
    expect(result).toEqual({
      imageUrl: 'https://img/a.jpg',
      source: 'reference',
    });
  });

  it('falls back to main when reference variant has no image', () => {
    const result = resolveI2iBaseImage('char-variant-b', siblings);
    expect(result).toEqual({
      imageUrl: 'https://img/main.jpg',
      source: 'main',
    });
  });

  it('falls back to main when reference_slug is null', () => {
    const result = resolveI2iBaseImage(null, siblings);
    expect(result).toEqual({
      imageUrl: 'https://img/main.jpg',
      source: 'main',
    });
  });

  it('falls back to main when reference_slug is undefined', () => {
    const result = resolveI2iBaseImage(undefined, siblings);
    expect(result).toEqual({
      imageUrl: 'https://img/main.jpg',
      source: 'main',
    });
  });

  it('falls back to main when reference_slug matches no sibling', () => {
    const result = resolveI2iBaseImage('nonexistent', siblings);
    expect(result).toEqual({
      imageUrl: 'https://img/main.jpg',
      source: 'main',
    });
  });

  it('returns none when no reference and main has no image', () => {
    const noImages = [
      {
        slug: 'char-main',
        is_main: true,
        image_url: null,
        image_gen_status: idle,
      },
    ];
    const result = resolveI2iBaseImage(null, noImages);
    expect(result).toEqual({ imageUrl: null, source: 'none' });
  });

  it('returns none when reference has no image and main has no image', () => {
    const noImages = [
      {
        slug: 'char-main',
        is_main: true,
        image_url: null,
        image_gen_status: idle,
      },
      {
        slug: 'char-variant-a',
        is_main: false,
        image_url: null,
        image_gen_status: idle,
      },
    ];
    const result = resolveI2iBaseImage('char-variant-a', noImages);
    expect(result).toEqual({ imageUrl: null, source: 'none' });
  });

  it('skips reference variant that is still generating', () => {
    const partialGen = [
      {
        slug: 'char-main',
        is_main: true,
        image_url: 'https://img/main.jpg',
        image_gen_status: completed,
      },
      {
        slug: 'char-variant-a',
        is_main: false,
        image_url: 'https://img/a-partial.jpg',
        image_gen_status: generating,
      },
    ];
    const result = resolveI2iBaseImage('char-variant-a', partialGen);
    expect(result).toEqual({
      imageUrl: 'https://img/main.jpg',
      source: 'main',
    });
  });

  it('returns none for empty siblings list', () => {
    const result = resolveI2iBaseImage('any-slug', []);
    expect(result).toEqual({ imageUrl: null, source: 'none' });
  });
});
