const bread = [
  "K Bread",
  "Jbest",
  "KFF",
  "Durable",
  "Etree",
  "Ostreech",
  "Bilkebab"
];
  
const products = [
  ...bread.map((n, i) => ({
    id: "bread-" + i,
    name: n + " Bread",
    price: 1500,
    cat: "bread",
    img: `images/bread-loaf-${(i % 3) + 1}.jpg`
  })),

  {
    id: "bounce",
    name: "Bunce",
    price: 400,
    cat: "bunce",
    img: "images/bunce.jpg"
  },

  {
    id: "eggroll",
    name: "Eggroll",
    price: 800,
    cat: "eggroll",
    img: "images/eggroll.jpg"
  },

  {
    id: "coke",
    name: "Coca-Cola",
    price: 500,
    cat: "minerals",
    img: "images/coke-1.jpg"
  },

  {
    id: "sprite",
    name: "Sprite",
    price: 500,
    cat: "minerals",
    img: "images/sprite-1.jpg"
  },

  {
    id: "fanta",
    name: "Fanta",
    price: 500,
    cat: "minerals",
    img: "images/fanta-1.jpg"
  },

  {
    id: "multina",
    name: "Multina",
    price: 700,
    cat: "minerals",
    img: "images/multina.jpg"
  }
];

function money(n) {
  return "₦" + Number(n).toLocaleString();
}

function getCart() {
  return JSON.parse(localStorage.getItem("sweetbiteCart") || "[]");
}

function saveCart(c) {
  localStorage.setItem("sweetbiteCart", JSON.stringify(c));
  updateCount();
}

function updateCount() {
  const n = getCart().reduce((s, x) => s + x.qty, 0);

  document
    .querySelectorAll("#cartCount")
    .forEach(e => e.textContent = n);
}

function add(id) {
  const c = getCart();
  const p = products.find(x => x.id === id);

  if (!p) return;

  const x = c.find(x => x.id === id);

  if (x) {
    x.qty++;
  } else {
    c.push({ ...p, qty: 1 });
  }

  saveCart(c);

  alert(p.name + " added to cart.");
}

function renderProducts() {
  const el = document.getElementById("products");

  if (!el) return;

  el.innerHTML = products.map(p => `
    <article class="product" id="${p.cat}">
      <img src="${p.img}" alt="${p.name}">
      <div class="product-body">
        <h3>${p.name}</h3>
        <div class="price">${money(p.price)}</div>
        <button class="btn" onclick="add('${p.id}')">
          Add to cart
        </button>
      </div>
    </article>
  `).join("");
}

function renderCart() {
  const el = document.getElementById("cartItems");

  if (!el) return;

  const c = getCart();

  if (!c.length) {
    el.innerHTML = `
      <p>
        Your cart is empty.
        <a href="menu.html">Browse the menu.</a>
      </p>
    `;
    return;
  }

  const sub = c.reduce(
    (s, x) => s + x.price * x.qty,
    0
  );

  el.innerHTML =
    c.map(x => `
      <div class="cart-row">
        <div>
          <b>${x.name}</b><br>
          ${money(x.price)} × ${x.qty}
        </div>

        <div>
          <button onclick="changeQty('${x.id}', -1)">−</button>
          <button onclick="changeQty('${x.id}', 1)">+</button>
        </div>
      </div>
    `).join("") +

    `
      <div class="totals">
        Items total: ${money(sub)}
        <br>
        <small>Delivery fee selected at checkout</small>
      </div>
    `;
}

function changeQty(id, d) {
  let c = getCart();

  const x = c.find(x => x.id === id);

  if (x) {
    x.qty += d;

    if (x.qty <= 0) {
      c = c.filter(y => y.id !== id);
    }
  }

  saveCart(c);
  renderCart();
}

function saveSpecial() {
  const x = document.getElementById("special");

  if (x) {
    localStorage.setItem("sweetbiteSpecial", x.value);
    alert("Special request saved.");
  }
}


/* ================================
   PAYSTACK CHECKOUT
================================ */

async function payAndPlaceOrder() {
  const cart = getCart();
  const form = document.getElementById("orderForm");
  const button = document.getElementById("payButton");
  const status = document.getElementById("paymentStatus");

  if (!cart.length) {
    alert("Your cart is empty.");
    return;
  }

  if (!form.reportValidity()) {
    return;
  }

  const data = Object.fromEntries(
    new FormData(form)
  );

  const deliveryFee = Number(data.zone);

  if (![1500, 1750, 2000].includes(deliveryFee)) {
    alert("Please select a valid delivery fee.");
    return;
  }

  const items = cart.map(x => ({
    name: x.name,
    qty: x.qty
  }));

  const landmark = String(data.landmark || "").trim();

  let address = String(data.address || "").trim();

  if (landmark) {
    address += ` (Landmark: ${landmark})`;
  }

  const payload = {
    customer_name: String(data.name || "").trim(),
    customer_email: String(data.email || "").trim(),
    customer_phone: String(data.phone || "").trim(),
    delivery_address: address,
    notes: String(data.special || "").trim(),
    items,
    delivery_fee: deliveryFee
  };

  try {
    button.disabled = true;
    button.textContent = "Connecting to Paystack...";

    if (status) {
      status.textContent =
        "Please wait while we prepare your secure payment.";
    }

    const response = await fetch(
      "/api/paystack/initialize",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.error || "Payment could not be initialized."
      );
    }

    if (!result.authorization_url || !result.reference) {
      throw new Error(
        "Paystack did not return a payment link."
      );
    }

    localStorage.setItem(
  "sweetbitePendingPayment",
  JSON.stringify({
    reference: result.reference,
    customer_name: payload.customer_name,
    customer_email: payload.customer_email,
    customer_phone: payload.customer_phone,
    delivery_address: payload.delivery_address,
    items: payload.items
  })
);
    if (status) {
      status.textContent =
        "Redirecting you to secure Paystack payment...";
    }

    window.location.href = result.authorization_url;

  } catch (error) {
    console.error("Payment initialization error:", error);

    alert(
      error.message ||
      "Something went wrong while starting payment."
    );

    button.disabled = false;
    button.textContent = "💳 Pay & Place Order";

    if (status) {
      status.textContent = "";
    }
  }
}


/* ================================
   CUSTOMER ORDERS
================================ */

function renderOrders() {
  const el = document.getElementById("orders");

  if (!el) return;

  const o = JSON.parse(
    localStorage.getItem("sweetbiteOrders") || "[]"
  );

  el.innerHTML = o.length
    ? o.map(x => `
        <div class="order-card">
          <b>${x.id}</b>

          <p>${x.date}</p>

          <pre style="white-space:pre-wrap;font:inherit">${String(
            x.msg || ""
          ).replace(/\\n/g, "\n")}</pre>

          <strong>
            Total: ${money(x.total)}
          </strong>
        </div>
      `).join("")

    : "<p>No orders on this device yet.</p>";
}


/* ================================
   STARTUP
================================ */

updateCount();
renderProducts();
renderCart();
renderOrders();

const savedSpecial =
  localStorage.getItem("sweetbiteSpecial");

const specialField =
  document.getElementById("special");

if (savedSpecial && specialField) {
  specialField.value = savedSpecial;
}
