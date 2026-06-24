import 'express';

declare global {
  namespace Express {
    interface Request {
      parent?: {
        emailId: string;
        email: string;
        sessionId: string;
      };
      admin?: {
        id: string;
        username: string;
      };
    }
  }
}

export {};
