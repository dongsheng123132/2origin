#!/usr/bin/env node
// Self-contained fallback for demo-publishing: verifies a publishing manifest is internally consistent.
// It deliberately accepts one JSON path only; malformed or inconsistent manuscripts exit non-zero.
import fs from 'node:fs';

const file = process.argv[2];
if (!file || process.argv.length !== 3) process.exit(2);
try {
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));
  const chapters = Array.isArray(book.chapters) ? book.chapters : [];
  const ordered = chapters.every((chapter, i) => chapter && chapter.number === i + 1 && typeof chapter.title === 'string' && chapter.title.trim());
  const uniqueTitles = new Set(chapters.map(x => x.title.trim())).size === chapters.length;
  const valid = typeof book.title === 'string' && book.title.trim().length >= 4
    && /^97[89]-\d{10}$/.test(book.isbn || '') && chapters.length >= 2 && ordered && uniqueTitles;
  process.exit(valid ? 0 : 1);
} catch { process.exit(1); }
