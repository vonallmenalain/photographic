import type { Handler } from "@netlify/functions";
import { requireUser } from "../lib/auth";
import { ensurePost, handleError, json } from "../lib/responses";

export const handler: Handler = async (event) => {
  const earlyResponse = ensurePost(event);
  if (earlyResponse) {
    return earlyResponse;
  }

  try {
    await requireUser(event);
    return json(501, {
      error: "Downloads werden erst nach bezahlten oder erfüllten Bestellungen freigegeben."
    });
  } catch (error) {
    return handleError(error);
  }
};
