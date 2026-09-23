export function registerOrderRoutes(app, { pool }) {
  app.get('/orders/:id', async (req, res) => res.json(await pool.query('select * from orders where id = $1', [req.params.id])))
  app.post('/orders', async (req, res) => res.status(201).json(await pool.query('insert into orders ...', [req.body])))
}
