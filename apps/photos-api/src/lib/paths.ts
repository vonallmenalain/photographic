import { nanoid, customAlphabet } from "nanoid";

const childCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);

export function randomId(size = 16) {
  return nanoid(size);
}

export function randomChildPseudonym() {
  return `Kind ${childCode()}`;
}
