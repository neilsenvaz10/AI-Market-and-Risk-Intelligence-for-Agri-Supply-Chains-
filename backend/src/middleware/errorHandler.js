/**
 * Centralized Error Handling Middleware for Express
 */
export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  console.error(`[Error] ${req.method} ${req.url} - Status: ${statusCode}`, err.stack || err.message);

  res.status(statusCode).json({
    status: 'error',
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    status: 'error',
    message: `Cannot ${req.method} ${req.originalUrl} - Route not found`,
  });
}
