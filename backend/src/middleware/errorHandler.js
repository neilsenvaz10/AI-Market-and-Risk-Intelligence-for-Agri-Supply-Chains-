/**
 * Centralized Error Handling Middleware for Express
 */
export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || err.status || 500;
  const isServerError = statusCode >= 500;

  if (isServerError && !err.expose) {
    console.error(`[Error] ${req.method} ${req.url} - Status: ${statusCode}`, err.stack || err.message);
  }

  // Never leak internal error details (SQL, stack traces) for unexpected 5xx errors.
  let message = err.message || 'Internal Server Error';
  if (isServerError && !err.expose) message = 'Internal Server Error';
  if (err.type === 'entity.parse.failed') message = 'Request body must be valid JSON';

  res.status(statusCode).json({
    status: 'error',
    ...(err.code && typeof err.code === 'string' && err.expose && { code: err.code }),
    message,
    ...(err.details && { details: err.details }),
    ...(process.env.NODE_ENV === 'development' && isServerError && { stack: err.stack }),
  });
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    status: 'error',
    message: `Cannot ${req.method} ${req.originalUrl} - Route not found`,
  });
}
