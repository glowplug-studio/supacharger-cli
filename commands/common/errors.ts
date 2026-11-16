/** Narrow thrown values without replacing them or changing their messages. */
export function hasErrorCode(error: unknown): error is Error & { code: string | number } {
  return error instanceof Error && 'code' in error;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
