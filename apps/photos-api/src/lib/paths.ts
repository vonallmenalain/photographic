import { nanoid } from "nanoid";

export function randomId(size = 16) {
  return nanoid(size);
}
