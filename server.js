// server.js
require('dotenv').config(); // ⚠️ IMPORTANTE: Agregar esta línea al inicio

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Configuración de PostgreSQL con mejor manejo de errores
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'tu_base_datos',
  password: process.env.DB_PASSWORD || 'tu_password',
  port: process.env.DB_PORT || 5432,
  // Configuraciones adicionales para conexiones remotas
  ssl: false, // Cambiar a true si el servidor requiere SSL
  connectionTimeoutMillis: 5000, // Timeout de 5 segundos
});

// Verificar configuración al iniciar
console.log('📝 Configuración de la base de datos:');
console.log(`   Host: ${process.env.DB_HOST}`);
console.log(`   Puerto: ${process.env.DB_PORT}`);
console.log(`   Base de datos: ${process.env.DB_NAME}`);
console.log(`   Usuario: ${process.env.DB_USER}`);
console.log(`   Password: ${process.env.DB_PASSWORD ? '✓ Configurado' : '✗ No configurado'}`);

// Manejo de errores de conexión del pool
pool.on('error', (err, client) => {
  console.error('❌ Error inesperado en el pool de PostgreSQL:', err);
});

// ====== RUTAS ======

// 1. Testear conexión a la base de datos
app.get('/api/test-connection', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      success: true,
      message: 'Conexión exitosa a la base de datos',
      timestamp: result.rows[0].now
    });
  } catch (error) {
    console.error('❌ Error de conexión:', error);
    res.status(500).json({
      success: false,
      message: 'Error al conectar con la base de datos',
      error: error.message,
      code: error.code
    });
  }
});

// DIAGNÓSTICO: Verificar estructura de la base de datos
app.get('/api/diagnostico', async (req, res) => {
  try {
    // 1. Verificar si el esquema existe
    const schemaCheck = await pool.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name = 'psicologia'
    `);

    // 2. Verificar si la tabla existe
    const tableCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'citas_gratuitas'
    `);

    // 3. Obtener columnas de la tabla
    const columnsCheck = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'citas_gratuitas'
      ORDER BY ordinal_position
    `);

    res.json({
      success: true,
      diagnostico: {
        esquemaExiste: schemaCheck.rows.length > 0,
        tablaExiste: tableCheck.rows.length > 0,
        columnas: columnsCheck.rows
      }
    });
  } catch (error) {
    console.error('❌ Error en diagnóstico:', error);
    res.status(500).json({
      success: false,
      message: 'Error en diagnóstico',
      error: error.message
    });
  }
});

// 2. Obtener todas las citas
app.get('/api/citas', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM public.citas_gratuitas 
      ORDER BY fecha_cita DESC
    `);
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('❌ Error al obtener citas:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener las citas',
      error: error.message
    });
  }
});

// Función auxiliar para enviar webhook a n8n
async function enviarWebhookN8n(evento, datos) {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  
  if (!webhookUrl) {
    console.log('⚠️ N8N_WEBHOOK_URL no configurado, webhook no enviado');
    return;
  }

  try {
    const payload = {
      evento: evento,
      timestamp: new Date().toISOString(),
      datos: datos
    };

    console.log(`📤 Enviando webhook a n8n: ${evento}`);
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      console.log('✅ Webhook enviado exitosamente a n8n');
    } else {
      console.error('❌ Error al enviar webhook:', response.status, response.statusText);
    }
  } catch (error) {
    console.error('❌ Error al enviar webhook a n8n:', error.message);
  }
}

// 3. Crear una cita
app.post('/api/citas', async (req, res) => {
  const { nombre, email, telefono, tipoFecha } = req.body;

  // Validaciones básicas
  if (!nombre || !email || !telefono || !tipoFecha) {
    return res.status(400).json({
      success: false,
      message: 'Faltan campos requeridos'
    });
  }

  // Calcular la fecha según el tipo
  let fechaCita = new Date();
  switch (tipoFecha) {
    case '24h':
      fechaCita.setHours(fechaCita.getHours() + 24);
      break;
    case '2h':
      fechaCita.setHours(fechaCita.getHours() + 2);
      break;
    case '1h_pasado':
      fechaCita.setHours(fechaCita.getHours() - 1);
      break;
    default:
      return res.status(400).json({
        success: false,
        message: 'Tipo de fecha inválido'
      });
  }

  try {
    const result = await pool.query(`
      INSERT INTO public.citas_gratuitas 
      (nombre, email, telefono, fecha_cita, recordatorio_24h_enviado, recordatorio_2h_enviado, recordatorio_post_enviado)
      VALUES ($1, $2, $3, $4, false, false, false)
      RETURNING *
    `, [nombre, email, telefono, fechaCita]);

    const citaCreada = result.rows[0];

    // 🔔 ENVIAR WEBHOOK A N8N
    await enviarWebhookN8n('cita_creada', citaCreada);

    res.status(201).json({
      success: true,
      message: 'Cita creada exitosamente',
      data: citaCreada
    });
  } catch (error) {
    console.error('❌ Error al crear cita:', error);
    res.status(500).json({
      success: false,
      message: 'Error al crear la cita',
      error: error.message
    });
  }
});

// 4. Eliminar una cita
app.delete('/api/citas/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(`
      DELETE FROM public.citas_gratuitas 
      WHERE id = $1
      RETURNING *
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Cita no encontrada'
      });
    }

    const citaEliminada = result.rows[0];

    // 🔔 ENVIAR WEBHOOK A N8N
    await enviarWebhookN8n('cita_eliminada', citaEliminada);

    res.json({
      success: true,
      message: 'Cita eliminada exitosamente',
      data: citaEliminada
    });
  } catch (error) {
    console.error('❌ Error al eliminar cita:', error);
    res.status(500).json({
      success: false,
      message: 'Error al eliminar la cita',
      error: error.message
    });
  }
});

// 5. Resetear flags de una cita específica
app.patch('/api/citas/:id/reset-flags', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(`
      UPDATE public.citas_gratuitas 
      SET recordatorio_24h_enviado = false,
          recordatorio_2h_enviado = false,
          recordatorio_post_enviado = false
      WHERE id = $1
      RETURNING *
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Cita no encontrada'
      });
    }

    res.json({
      success: true,
      message: 'Flags reseteados exitosamente',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Error al resetear flags:', error);
    res.status(500).json({
      success: false,
      message: 'Error al resetear los flags',
      error: error.message
    });
  }
});

// 5.1 NUEVO: Marcar recordatorio como enviado
app.patch('/api/citas/:id/marcar-recordatorio', async (req, res) => {
  const { id } = req.params;
  const { tipo } = req.body; // '24h', '2h', o 'post'

  if (!tipo || !['24h', '2h', 'post'].includes(tipo)) {
    return res.status(400).json({
      success: false,
      message: 'Tipo de recordatorio inválido. Debe ser: 24h, 2h o post'
    });
  }

  const columna = `recordatorio_${tipo === '24h' ? '24h' : tipo === '2h' ? '2h' : 'post'}_enviado`;

  try {
    const result = await pool.query(`
      UPDATE public.citas_gratuitas 
      SET ${columna} = true
      WHERE id = $1
      RETURNING *
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Cita no encontrada'
      });
    }

    res.json({
      success: true,
      message: `Recordatorio ${tipo} marcado como enviado`,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('❌ Error al marcar recordatorio:', error);
    res.status(500).json({
      success: false,
      message: 'Error al marcar el recordatorio',
      error: error.message
    });
  }
});

// 6. Resetear flags de todas las citas
app.patch('/api/citas/reset-flags/all', async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE public.citas_gratuitas 
      SET recordatorio_24h_enviado = false,
          recordatorio_2h_enviado = false,
          recordatorio_post_enviado = false
      RETURNING *
    `);

    res.json({
      success: true,
      message: `Flags reseteados para ${result.rows.length} citas`,
      data: result.rows
    });
  } catch (error) {
    console.error('❌ Error al resetear flags:', error);
    res.status(500).json({
      success: false,
      message: 'Error al resetear los flags',
      error: error.message
    });
  }
});

// 7. Eliminar todas las citas
app.delete('/api/citas', async (req, res) => {
  try {
    const result = await pool.query(`
      DELETE FROM public.citas_gratuitas 
      RETURNING *
    `);

    res.json({
      success: true,
      message: `${result.rows.length} citas eliminadas exitosamente`
    });
  } catch (error) {
    console.error('❌ Error al eliminar citas:', error);
    res.status(500).json({
      success: false,
      message: 'Error al eliminar las citas',
      error: error.message
    });
  }
});

// Ruta raíz - mensaje de bienvenida
app.get('/', (req, res) => {
  res.json({
    message: '🗓️ API Demo Sistema de Recordatorios',
    status: 'running',
    webhookConfigured: !!process.env.N8N_WEBHOOK_URL,
    endpoints: {
      'GET /api/test-connection': 'Probar conexión a la base de datos',
      'GET /api/diagnostico': 'Verificar estructura de la base de datos',
      'GET /api/citas': 'Obtener todas las citas',
      'POST /api/citas': 'Crear una cita (envía webhook a n8n)',
      'DELETE /api/citas/:id': 'Eliminar una cita (envía webhook a n8n)',
      'PATCH /api/citas/:id/reset-flags': 'Resetear flags de una cita',
      'PATCH /api/citas/:id/marcar-recordatorio': 'Marcar recordatorio como enviado',
      'PATCH /api/citas/reset-flags/all': 'Resetear todos los flags',
      'DELETE /api/citas': 'Eliminar todas las citas'
    },
    webhooks: {
      eventos: ['cita_creada', 'cita_eliminada'],
      configuracion: 'Agregar N8N_WEBHOOK_URL en el archivo .env'
    },
    frontend: 'Abre index.html en tu navegador'
  });
});

// Iniciar servidor
app.listen(PORT, async () => {
  console.log(`\n🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📊 API disponible en http://localhost:${PORT}/api`);
  
  // Probar conexión al iniciar
  console.log('\n🔄 Probando conexión a la base de datos...');
  try {
    await pool.query('SELECT NOW()');
    console.log('✅ Conexión a PostgreSQL exitosa\n');
  } catch (error) {
    console.error('❌ Error al conectar con PostgreSQL:');
    console.error(`   Mensaje: ${error.message}`);
    console.error(`   Código: ${error.code}\n`);
  }
});

// Manejo de cierre graceful
process.on('SIGTERM', () => {
  console.log('🛑 Cerrando servidor...');
  pool.end();
  process.exit(0);
});