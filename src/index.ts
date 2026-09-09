import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';
import { cors } from 'hono/cors';
import { createClient } from '@supabase/supabase-js';
import products from './routes/products';
import carts from './routes/carts';
import addresses from './routes/addresses';
import adminAddresses from './routes/admin-addresses';
import adminCustomers from './routes/admin-customers';
import adminProducts from './routes/admin-products';
import adminCustomerOptions from './routes/admin-customer-options';
import adminProductOptions from './routes/admin-product-options';
import adminTransactions from './routes/admin-transactions';
import checkout from './routes/checkout';
import adminCountDeliveryCost from './routes/admin-count-delivery-cost';
import adminDistance from './routes/admin-distance';
import adminGeocode from './routes/admin-geocode';
import adminTransactionDeliveries from './routes/admin-transaction-deliveries';
import adminSettings from './routes/admin-settings';
import myProfile from './routes/my-profile';
import orderHistory from './routes/order-history';
import invoice from './routes/invoice';
import aiChat from './routes/ai-chat';
import auth from './routes/auth';
import adminDashboard from './routes/admin-dashboard';
import adminInvoices from './routes/admin-invoices';
import adminAiModels from './routes/admin-ai-models';
import adminNotes from './routes/admin-notes';
import adminTransactionTemplates from './routes/admin-transaction-templates';
import telegramWebhook from './routes/telegram-webhook';
import siteContent from './routes/site-content';
import adminSiteContent from './routes/admin-site-content';
import { requireAuth, requireAdmin } from './middleware/auth';
import { rateLimit, secureHeaders, swaggerBasicAuth } from './middleware/security';
import { Bindings, Variables } from './types';

const app = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

app.use('*', cors({
  origin: [
    'http://localhost:4321',
    'http://127.0.0.1:4321',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://kembang-cms.langganan-ku.my.id',
    'https://kembang.langganan-ku.my.id',
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Login-Device'],
  credentials: true
}));

app.use('*', async (c, next) => {
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  c.set('supabase', supabase);
  await next();
});

// --- Guards ---

// Secure headers untuk semua response
app.use('*', secureHeaders);

// Global rate limit: 120 request / menit / IP (webhook telegram dikecualikan)
app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/') && c.req.path.includes('telegram')) return next();
  return rateLimit({ name: 'global', windowMs: 60_000, max: 120 })(c, next);
});

// Throttle ketat untuk endpoint auth (brute force protection):
// register: 10 / 5 menit / IP, forgot-password: 5 / 5 menit / IP,
// OAuth: 10 / 5 menit / IP untuk mencegah abuse provider redirect/session handoff.
app.use('/api/v1/auth/register', rateLimit({ name: 'auth-register', windowMs: 300_000, max: 10 }));
app.use('/api/v1/auth/forgot-password', rateLimit({ name: 'auth-forgot', windowMs: 300_000, max: 5 }));
app.use('/api/v1/auth/oauth/*', rateLimit({ name: 'auth-oauth', windowMs: 300_000, max: 10 }));

// PIN settings itu secret pendek (rentan brute force) — batasi ketat: 10 / 5 menit / IP
app.use('/api/v1/admin/settings/verify-pin', rateLimit({ name: 'settings-pin', windowMs: 300_000, max: 10 }));
app.use('/api/v1/admin/site-content/home/publish', rateLimit({ name: 'site-content-publish', windowMs: 300_000, max: 10 }));
app.use('/api/v1/admin/site-content/home/rebuild', rateLimit({ name: 'site-content-rebuild', windowMs: 300_000, max: 10 }));
app.use('/api/v1/admin/products/media', rateLimit({ name: 'product-photo-upload', windowMs: 300_000, max: 30 }));

// Webhook telegram dikecualikan dari global limit, tapi tetap perlu batas
// sendiri supaya endpoint publik ini tidak bisa dipakai buat menguras kuota AI.
app.use('/telegram/webhook', rateLimit({ name: 'telegram-webhook', windowMs: 60_000, max: 30 }));

// Swagger docs dilindungi Basic Auth (kredensial dari SWAGGER_USERNAME/SWAGGER_PASSWORD)
app.use('/docs', swaggerBasicAuth());
app.use('/openapi.json', swaggerBasicAuth());

app.use('/api/v1/carts/*', requireAuth);
app.use('/api/v1/addresses/*', requireAuth);
// Urutan penting: requireAuth resolve identitas + role, requireAdmin baru
// menegakkan otorisasinya. Tanpa requireAdmin, customer biasa (yang login lewat
// endpoint /auth/login yang sama dengan CMS) bisa menembus seluruh route admin.
app.use('/api/v1/admin/*', requireAuth);
app.use('/api/v1/admin/*', requireAdmin);
app.use('/api/v1/my-profile/*', requireAuth);
app.use('/api/v1/order-history/*', requireAuth);
app.use('/api/v1/checkout/*', requireAuth);

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['Health'],
  responses: {
    200: {
      description: 'Service is up',
      content: { 'application/json': { schema: z.object({ status: z.literal('ok') }) } },
    },
  },
});

app.openapi(healthRoute, (c) => c.json({ status: 'ok' as const }));

const orders = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

orders.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Orders'],
    responses: {
      200: {
        description: 'List orders',
        content: { 'application/json': { schema: z.object({ message: z.string() }) } },
      },
    },
  }),
  (c) => c.json({ message: 'TODO: GET /orders' }),
);

orders.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Orders'],
    request: {
      body: {
        content: { 'application/json': { schema: z.object({}).passthrough() } },
      },
    },
    responses: {
      201: {
        description: 'Order created',
        content: { 'application/json': { schema: z.object({ message: z.string() }) } },
      },
    },
  }),
  (c) => c.json({ message: 'TODO: POST /orders' }, 201),
);

const deliveries = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

deliveries.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Deliveries'],
    responses: {
      200: {
        description: 'List deliveries',
        content: { 'application/json': { schema: z.object({ message: z.string() }) } },
      },
    },
  }),
  (c) => c.json({ message: 'TODO: GET /deliveries' }),
);

app.route('/orders', orders);
app.route('/deliveries', deliveries);
app.route('/api/v1/products', products);
app.route('/api/v1/site-content', siteContent);
app.route('/api/v1/carts', carts);
app.route('/api/v1/addresses', addresses);
app.route('/api/v1/admin/customers/:customerId/addresses', adminAddresses);
app.route('/api/v1/admin/customers', adminCustomers);
app.route('/api/v1/admin/transactions', adminTransactions);
app.route('/api/v1/admin/products', adminProducts);
app.route('/api/v1/admin/customer-options', adminCustomerOptions);
app.route('/api/v1/admin/product-options', adminProductOptions);
app.route('/api/v1/admin/count-delivery-cost', adminCountDeliveryCost);
app.route('/api/v1/admin/distance', adminDistance);
app.route('/api/v1/admin/geocode', adminGeocode);
app.route('/api/v1/admin/transaction-deliveries', adminTransactionDeliveries);
app.route('/api/v1/admin/settings', adminSettings);
app.route('/api/v1/admin/site-content', adminSiteContent);
app.route('/api/v1/admin/dashboard', adminDashboard);
app.route('/api/v1/admin/invoices', adminInvoices);
app.route('/api/v1/admin/ai-models', adminAiModels);
app.route('/api/v1/admin/notes', adminNotes);
app.route('/api/v1/admin/transaction-templates', adminTransactionTemplates);
app.route('/api/v1/auth', auth);
app.route('/api/v1/my-profile', myProfile);
app.route('/api/v1/order-history', orderHistory);
app.route('/api/v1/invoice', invoice);
app.route('/api/v1/checkout', checkout);
app.route('/api/v1/ai/chat', aiChat);
app.route('/telegram/webhook', telegramWebhook);

app.doc('/openapi.json', {
  openapi: '3.0.0',
  info: { title: 'Kembang API', version: '0.0.1' },
});

app.get('/docs', swaggerUI({ url: '/openapi.json' }));

export default app;
