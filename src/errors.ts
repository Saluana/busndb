export class ValidationError extends Error {
  constructor(message: string, public details?: any) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class UniqueConstraintError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'UniqueConstraintError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string, public id?: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class DatabaseError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'DatabaseError';
  }
}