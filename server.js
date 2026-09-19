import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express(); 
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 10000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const SITE_URL =
  process.env.SITE_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  'http://localhost:10000';
 
const WA_NUMBER = '2349041130288';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('Missing Supabase server environment variables');
}

if (!PAYSTACK_SECRET_KEY) {
  console.warn('Missing PAYSTACK_SECRET_KEY');
}

const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false }
      })
    : null;

const cleanPhone = (value) =>
  String(value || '').replace(/\D/g, '');

const money = (n) =>
  `₦${Number(n || 0).toLocaleString('en-NG')}`;

const orderNo = () =>
  `SB-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto
    .randomBytes(3)
    .toString('hex')
    .toUpperCase()}`;

const bad = (res, msg, status = 400) =>
  res.status(status).json({ error: msg });

/* -------------------------------------------------------
   BASIC ROUTES
------------------------------------------------------- */

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'sweetbite'
  });
});

app.get('/api/products', async (req, res) => {
  try {
    if (!supabase) {
      return bad(res, 'Database is not configured', 503);
    }

    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('is_available', true)
      .order('created_at', { ascending: true });

    if (error) {
      return bad(res, error.message, 500);
    }

    res.json({
      products: data || []
    });
  } catch (e) {
    console.error(e);
    bad(res, 'Could not load products', 500);
  }
});

/* -------------------------------------------------------
   VALIDATE CART FROM DATABASE
------------------------------------------------------- */

async function validateCart(items) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error('Cart is empty');
  }

  const names = [
  ...new Set(
    items
      .map((x) =>
        String(
          x?.name || x?.product_name || ''
        ).trim()
      )
      .filter(Boolean)
  )
];

  const { data: products, error } = await supabase
    .from('products')
    .select('id,name,price,is_available')
    .in('name', names);

  if (error) {
    throw new Error(error.message);
  }

  const byName = new Map(
    (products || []).map((p) => [p.name, p])
  );

  const cleanItems = [];
/* -------------------------------------------------------
   PRODUCT AND QTY
------------------------------------------------------- */
for (const raw of items) {
  const name = String(
    raw?.name || raw?.product_name || ''
  ).trim();

  const product = byName.get(name);

  const qty = Math.max(
    1,
    Math.min(
      50,
      Number.parseInt(
        raw?.qty ?? raw?.quantity,
        10
      ) || 0
    )
  );

    if (!product || !product.is_available || qty < 1) {
      throw new Error(
        `Product unavailable: ${name || 'Unknown product'}`
      );
    }

    cleanItems.push({
      product_id: product.id,
      product_name: product.name,
      quantity: qty,
      unit_price: Number(product.price)
    });
  }

  const subtotal = cleanItems.reduce(
    (sum, item) =>
      sum + item.quantity * item.unit_price,
    0
  );

  return {
    cleanItems,
    subtotal
  };
}

/* -------------------------------------------------------
   CREATE ORDER AFTER SUCCESSFUL PAYMENT
------------------------------------------------------- */

async function createPaidOrder({
  customer_name,
  customer_email,
  customer_phone,
  delivery_address,
  notes,
  delivery_fee,
  cleanItems,
  paystackReference
}) {
  /* Prevent duplicate order creation */
  const { data: existing } = await supabase
    .from('orders')
    .select('*,order_items(*)')
    .eq('paystack_reference', paystackReference)
    .maybeSingle();

  if (existing) {
    return existing;
  }

  const subtotal = cleanItems.reduce(
    (sum, item) =>
      sum + item.quantity * item.unit_price,
    0
  );

  const total_amount = subtotal + delivery_fee;

  /* Customer */
  const { data: customer, error: customerError } =
    await supabase
      .from('customers')
      .insert({
        name: customer_name,
        email: customer_email,
        phone: customer_phone,
        address: delivery_address
      })
      .select('id')
      .single();

  if (customerError) {
    throw new Error(customerError.message);
  }

  /* Order */
  const order_number = orderNo();

  const { data: order, error: orderError } =
    await supabase
      .from('orders')
      .insert({
        order_number,
        customer_id: customer.id,
        customer_name,
        customer_email,
        customer_phone,
        delivery_address,
        customer_notes: notes || null,
        subtotal,
        delivery_fee,
        total_amount,
        payment_method: 'paystack',
        payment_status: 'paid',
        paystack_reference: paystackReference
      })
      .select('*')
      .single();

  if (orderError) {
    throw new Error(orderError.message);
  }

  /* Order items */
  const { error: itemError } = await supabase
    .from('order_items')
    .insert(
      cleanItems.map((item) => ({
        ...item,
        order_id: order.id
      }))
    );

  if (itemError) {
    await supabase
      .from('orders')
      .delete()
      .eq('id', order.id);

    throw new Error(itemError.message);
  }

  /* Payment record */
  const { error: paymentError } = await supabase
    .from('payments')
    .insert({
      order_id: order.id,
      provider: 'paystack',
      reference: paystackReference,
      amount: total_amount,
      currency: 'NGN',
      status: 'success',
      paid_at: new Date().toISOString()
    });

  if (paymentError) {
    console.error(
      'Payment record error:',
      paymentError.message
    );
  }

return {
  ...order,
  order_items: cleanItems
};
}

/* -------------------------------------------------------
   PAYSTACK API
------------------------------------------------------- */

async function paystackRequest(endpoint, options = {}) {
  if (!PAYSTACK_SECRET_KEY) {
    throw new Error('Paystack is not configured');
  }

  const response = await fetch(
    `https://api.paystack.co${endpoint}`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    }
  );

  const json = await response.json();

  if (!response.ok || json.status === false) {
    throw new Error(
      json.message || 'Paystack request failed'
    );
  }

  return json;
}

/* -------------------------------------------------------
   INITIALIZE PAYMENT
   IMPORTANT:
   NO ORDER IS CREATED HERE.
------------------------------------------------------- */

app.post('/api/paystack/initialize', async (req, res) => {
  try {
    if (!supabase) {
      return bad(res, 'Database is not configured', 503);
    }

    if (!PAYSTACK_SECRET_KEY) {
      return bad(res, 'Paystack is not configured', 503);
    }

    let {
      customer_name,
      customer_email,
      customer_phone,
      delivery_address,
      notes,
      items,
      delivery_fee
    } = req.body || {};

    customer_name = String(customer_name || '').trim();
    customer_email = String(customer_email || '').trim();
    customer_phone = cleanPhone(customer_phone);
    delivery_address = String(
      delivery_address || ''
    ).trim();
    notes = String(notes || '').trim();

    delivery_fee = Number(delivery_fee);

    if (!customer_name) {
      return bad(res, 'Full name is required');
    }

    if (!customer_email) {
      return bad(
        res,
        'Email address is required for online payment'
      );
    }

    if (!customer_email.includes('@')) {
      return bad(res, 'Please enter a valid email address');
    }

    if (customer_phone.length < 7) {
      return bad(res, 'Valid phone number is required');
    }

    if (!delivery_address) {
      return bad(res, 'Delivery address is required');
    }

    if (![1500, 1750, 2000].includes(delivery_fee)) {
      return bad(
        res,
        'Please select a valid delivery fee: ₦1,500, ₦1,750 or ₦2,000'
      );
    }

    const { cleanItems, subtotal } =
      await validateCart(items);

    const total_amount = subtotal + delivery_fee;

    /*
      These details are stored in Paystack metadata.
      The server has already validated the products and prices.
    */
    const metadata = {
      customer_name,
      customer_email,
      customer_phone,
      delivery_address,
      notes,
      delivery_fee,
      items: cleanItems
    };

    const reference =
      `SB-${Date.now()}-${crypto
        .randomBytes(4)
        .toString('hex')}`;

    const payment = await paystackRequest(
      '/transaction/initialize',
      {
        method: 'POST',
        body: JSON.stringify({
          email: customer_email,
          amount: total_amount * 100,
          currency: 'NGN',
          reference,
          callback_url:
            `${SITE_URL}/payment-complete.html`,
          metadata
        })
      }
    );

    res.json({
      ok: true,
      authorization_url:
        payment.data.authorization_url,
      access_code: payment.data.access_code,
      reference
    });
  } catch (e) {
    console.error(
      'Payment initialization error:',
      e
    );

    bad(
      res,
      e.message || 'Payment initialization failed',
      500
    );
  }
});

/* -------------------------------------------------------
   VERIFY PAYMENT
   ORDER IS CREATED ONLY AFTER SUCCESSFUL PAYMENT
------------------------------------------------------- */

app.get(
  '/api/paystack/verify/:reference',
  async (req, res) => {
    try {
      if (!supabase) {
        return bad(
          res,
          'Database is not configured',
          503
        );
      }

      const reference = String(
        req.params.reference || ''
      ).trim();

      if (!reference) {
        return bad(res, 'Payment reference is required');
      }

      const payment = await paystackRequest(
        `/transaction/verify/${encodeURIComponent(
          reference
        )}`
      );

      const data = payment.data;

      if (
        data.status !== 'success' ||
        data.currency !== 'NGN'
      ) {
        return res.status(400).json({
          ok: false,
          error: 'Payment was not successful'
        });
      }

      const metadata = data.metadata || {};

      if (
        !metadata.customer_name ||
        !metadata.customer_email ||
        !metadata.customer_phone ||
        !metadata.delivery_address ||
        !Array.isArray(metadata.items)
      ) {
        return bad(
          res,
          'Payment metadata is incomplete',
          400
        );
      }

      const delivery_fee = Number(
        metadata.delivery_fee
      );

      if (
        ![1500, 1750, 2000].includes(
          delivery_fee
        )
      ) {
        return bad(
          res,
          'Invalid delivery fee',
          400
        );
      }

      /*
        Re-read product prices from Supabase.
        We NEVER trust prices from the browser.
      */
      const { cleanItems, subtotal } =
        await validateCart(metadata.items);

      const expectedAmount =
        (subtotal + delivery_fee) * 100;

      if (Number(data.amount) !== expectedAmount) {
        return bad(
          res,
          'Payment amount does not match the order',
          400
        );
      }

      const order = await createPaidOrder({
        customer_name: metadata.customer_name,
        customer_email: metadata.customer_email,
        customer_phone: cleanPhone(
          metadata.customer_phone
        ),
        delivery_address:
          metadata.delivery_address,
        notes: metadata.notes || '',
        delivery_fee,
        cleanItems,
        paystackReference: reference
      });

      /*
        Build WhatsApp notification
      */
      const lines = cleanItems
        .map(
          (item) =>
            `${item.product_name} x ${item.quantity} = ${money(
              item.quantity * item.unit_price
            )}`
        )
        .join('\n');

      const message = [
        'SWEETBITE NEW PAID ORDER',
        `Order: ${order.order_number}`,
        `Name: ${metadata.customer_name}`,
        `Phone: ${metadata.customer_phone}`,
        `Address: ${metadata.delivery_address}`,
        '',
        'ITEMS',
        lines,
        '',
        `Subtotal: ${money(subtotal)}`,
        `Delivery: ${money(delivery_fee)}`,
        `TOTAL PAID: ${money(
          subtotal + delivery_fee
        )}`,
        'Payment: Paystack - PAID'
      ].join('\n');

      const whatsapp_url =
        `https://wa.me/${WA_NUMBER}?text=` +
        encodeURIComponent(message);

      res.json({
        ok: true,
        paid: true,
        order,
        whatsapp_url
      });
    } catch (e) {
      console.error(
        'Payment verification error:',
        e
      );

      bad(
        res,
        e.message || 'Payment verification failed',
        500
      );
    }
  }
);

/* -------------------------------------------------------
   PAYSTACK WEBHOOK
------------------------------------------------------- */

app.post('/api/paystack/webhook', async (req, res) => {
  try {
    const signature =
      req.headers['x-paystack-signature'];

    const expected = crypto
      .createHmac(
        'sha512',
        PAYSTACK_SECRET_KEY || ''
      )
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (
      !signature ||
      signature !== expected
    ) {
      return res.sendStatus(401);
    }

    /*
      Respond immediately to Paystack.
    */
    res.sendStatus(200);

    if (
      req.body?.event !== 'charge.success' ||
      !req.body?.data?.reference
    ) {
      return;
    }

    const reference =
      req.body.data.reference;

    /*
      Verify directly with Paystack before
      creating the paid order.
    */
    try {
      const payment =
        await paystackRequest(
          `/transaction/verify/${encodeURIComponent(
            reference
          )}`
        );

      const data = payment.data;

      if (
        data.status !== 'success' ||
        data.currency !== 'NGN'
      ) {
        return;
      }

      const metadata = data.metadata || {};

      if (
        !metadata.customer_name ||
        !metadata.customer_email ||
        !metadata.customer_phone ||
        !metadata.delivery_address ||
        !Array.isArray(metadata.items)
      ) {
        return;
      }

      const delivery_fee = Number(
        metadata.delivery_fee
      );

      if (
        ![1500, 1750, 2000].includes(
          delivery_fee
        )
      ) {
        return;
      }

      const { cleanItems, subtotal } =
        await validateCart(metadata.items);

      const expectedAmount =
        (subtotal + delivery_fee) * 100;

      if (
        Number(data.amount) !== expectedAmount
      ) {
        return;
      }

      await createPaidOrder({
        customer_name:
          metadata.customer_name,
        customer_email:
          metadata.customer_email,
        customer_phone:
          cleanPhone(metadata.customer_phone),
        delivery_address:
          metadata.delivery_address,
        notes: metadata.notes || '',
        delivery_fee,
        cleanItems,
        paystackReference: reference
      });
    } catch (err) {
      console.error(
        'Webhook processing error:',
        err
      );
    }
  } catch (e) {
    console.error(
      'Webhook error:',
      e
    );

    /*
      If headers have already been sent,
      don't attempt another response.
    */
    if (!res.headersSent) {
      return res.sendStatus(500);
    }
  }
});

/* ------------------------------------------------------
   ORDER LOOKUP
------------------------------------------------------- */

app.get('/api/orders/lookup', async (req, res) => {
  try {
    if (!supabase) {
      return bad(
        res,
        'Database is not configured',
        503
      );
    }

    const number = String(
      req.query.order_number || ''
    ).trim();

    const phone = cleanPhone(
      req.query.phone
    );

    if (
      !number ||
      phone.length < 7
    ) {
      return bad(
        res,
        'Order number and phone are required'
      );
    }

    const { data, error } =
      await supabase
        .from('orders')
        .select('*,order_items(*)')
        .eq('order_number', number)
        .eq('customer_phone', phone)
        .single();

    if (error || !data) {
      return bad(
        res,
        'Order not found',
        404
      );
    }

    res.json({
      order: data
    });
  } catch (e) {
    console.error(e);
    bad(
      res,
      'Could not look up order',
      500
    );
  }
});

/* -------------------------------------------------------
   STATIC WEBSITE
------------------------------------------------------- */

app.use(express.static(__dirname));

/*
  Express 5 wildcard syntax
*/
app.get(
  '/{*splat}',
  (req, res) =>
    res.sendFile(
      path.join(__dirname, 'index.html')
    )
);

app.listen(
  PORT,
  '0.0.0.0',
  () =>
    console.log(
      `SweetBite running on port ${PORT}`
    )
);
