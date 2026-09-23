export function registerCatalogRoutes(app, { pool, cache }) {
  app.get('/products', async (req, res) => res.json(await cache.wrap('products', () => pool.query('select * from products'))))
}
