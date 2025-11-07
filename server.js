// server.js - Backend API para Sistema de Citas Psicológicas
// npm install express pg cors dotenv

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Configuración de PostgreSQL
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
  ssl: process.env.DB_SSL === 'false' ? { rejectUnauthorized: false } : false
});

// Verificar conexión a la base de datos
pool.connect((err, client, release) => {
  if (err) {
    return console.error('Error al conectar a la base de datos:', err.stack);
  }
  console.log('Conectado a PostgreSQL exitosamente');
  release();
});

// ==================== ENDPOINTS ====================

// GET - Obtener todas las citas
app.get('/api/citas', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM citas ORDER BY fecha, hora'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener citas:', error);
    res.status(500).json({ error: 'Error al obtener las citas' });
  }
});

// GET - Obtener una cita específica por ID
app.get('/api/citas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM citas WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al obtener cita:', error);
    res.status(500).json({ error: 'Error al obtener la cita' });
  }
});

// POST - Crear una nueva cita
app.post('/api/citas', async (req, res) => {
  try {
    const { nombre, apellido, email, telefono, fecha, hora, motivo, notas } = req.body;
    
    // Validaciones básicas
    if (!nombre || !apellido || !email || !telefono || !fecha || !hora || !motivo) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }
    
    // Verificar si ya existe una cita en esa fecha y hora
    const existente = await pool.query(
      'SELECT * FROM citas WHERE fecha = $1 AND hora = $2 AND estado != $3',
      [fecha, hora, 'cancelada']
    );
    
    if (existente.rows.length > 0) {
      return res.status(409).json({ error: 'Ya existe una cita en ese horario' });
    }
    
    const result = await pool.query(
      `INSERT INTO citas (nombre, apellido, email, telefono, fecha, hora, motivo, notas, estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [nombre, apellido, email, telefono, fecha, hora, motivo, notas || null, 'confirmada']
    );
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error al crear cita:', error);
    res.status(500).json({ error: 'Error al crear la cita' });
  }
});

// PUT - Actualizar una cita
app.put('/api/citas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, apellido, email, telefono, fecha, hora, motivo, notas, estado } = req.body;
    
    const result = await pool.query(
      `UPDATE citas 
       SET nombre = $1, apellido = $2, email = $3, telefono = $4, 
           fecha = $5, hora = $6, motivo = $7, notas = $8, estado = $9,
           fecha_actualizacion = CURRENT_TIMESTAMP
       WHERE id = $10
       RETURNING *`,
      [nombre, apellido, email, telefono, fecha, hora, motivo, notas, estado, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al actualizar cita:', error);
    res.status(500).json({ error: 'Error al actualizar la cita' });
  }
});

// DELETE - Eliminar una cita (soft delete)
app.delete('/api/citas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query(
      `UPDATE citas 
       SET estado = 'cancelada', fecha_actualizacion = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }
    
    res.json({ message: 'Cita cancelada exitosamente', cita: result.rows[0] });
  } catch (error) {
    console.error('Error al cancelar cita:', error);
    res.status(500).json({ error: 'Error al cancelar la cita' });
  }
});

// GET - Obtener citas por fecha
app.get('/api/citas/fecha/:fecha', async (req, res) => {
  try {
    const { fecha } = req.params;
    const result = await pool.query(
      'SELECT * FROM citas WHERE fecha = $1 ORDER BY hora',
      [fecha]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener citas por fecha:', error);
    res.status(500).json({ error: 'Error al obtener las citas' });
  }
});

// GET - Obtener citas pendientes (próximas citas)
app.get('/api/citas/pendientes', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM citas 
       WHERE fecha >= CURRENT_DATE 
       AND estado = 'confirmada'
       ORDER BY fecha, hora`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener citas pendientes:', error);
    res.status(500).json({ error: 'Error al obtener las citas pendientes' });
  }
});

// Endpoint de health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.send(`
    <h1>🚀 API de Citas Psicológicas</h1>
    <p>El servidor está funcionando correctamente.</p>
    <p>Prueba los siguientes endpoints:</p>
    <ul>
      <li><a href="/health">/health</a></li>
      <li><a href="/api/citas">/api/citas</a></li>
    </ul>
  `);
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
  console.log(`API disponible en http://localhost:${PORT}/api/citas`);

});



