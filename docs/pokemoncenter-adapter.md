# Pokémon Center Online Adapter

Auto-generated OpenCLI adapter for [ポケモンセンターオンライン](https://www.pokemoncenter-online.com)

Plugin location: `~/.opencli/plugins/auto-pokemoncenter/`

## Commands

| Command | Description |
|---------|-------------|
| `search-products` | Search products by keyword |
| `add-to-cart` | Add a product to cart |
| `view-cart` | View current cart items |
| `list-categories` | List navigation categories |
| `buy-4-1` | Step 1: Shipping address & delivery |
| `buy-4-2` | Step 2: Payment method |
| `buy-4-3` | Step 3: Order confirmation (pauses before submit) |
| `buy-4-4` | Step 4: Check order completion |

## Full Purchase Flow

### Step 1: Search

```bash
opencli pokemoncenter search-products "ポケピース／Mocchi-Mocchi-Style／ぬいぐるみ／ヒバニー"
```

Returns: `rank`, `product_name`, `price`, `product_id`, `url`

### Step 2: Add to Cart

```bash
opencli pokemoncenter add-to-cart <product_id>

# With quantity
opencli pokemoncenter add-to-cart 4904790799655 --quantity 2
```

### Step 3: View Cart

```bash
opencli pokemoncenter view-cart
```

Returns only real cart items: `product_name`, `price`, `quantity`, `subtotal`, `product_id`

### Step 4-1: Shipping Address

```bash
# Default: registered address + standard shipping
opencli pokemoncenter buy-4-1

# Explicit options
opencli pokemoncenter buy-4-1 --address 1 --date 1
```

| Option | Values |
|--------|--------|
| `--address` | `1` = 登録住所 (default), `2` = 新しいお届け先 |
| `--date` | `1` = 通常発送 (default, 2-5 days), `2` = お届け日時を指定する |

### Step 4-2: Payment Method

Three payment options:

```bash
# a. Credit card
opencli pokemoncenter buy-4-2 credit \
  --card-name "WANG YIBU" \
  --card-number "4111111111111111" \
  --card-mm 12 --card-yy 28 --card-cvv 123

# b. Cash on delivery (+330 yen)
opencli pokemoncenter buy-4-2 cod

# c. Convenience store payment (+165 yen)
opencli pokemoncenter buy-4-2 cvs --store seven
```

| CVS Store | Value |
|-----------|-------|
| セブンイレブン | `seven` |
| ローソン | `lawson` |
| ファミリーマート | `family` |
| デイリーヤマザキ | `daily` |
| ミニストップ | `mini` |
| セイコーマート | `seico` |

### Step 4-3: Order Confirmation

```bash
opencli pokemoncenter buy-4-3
```

Displays order summary:
- Product list (name, price, quantity)
- 商品合計 / 送料 / 手数料 / 支払合計
- Payment method

**⚠️ Pauses before「注文を確定する」button — does NOT place order.**

Complete the order manually in the browser.

### Step 4-4: Check Order Result

```bash
opencli pokemoncenter buy-4-4
```

Run after manually clicking「注文を確定する」in browser. Checks if order was placed successfully and returns order ID.

## Technical Notes

- Platform: Salesforce Commerce Cloud (Demandware)
- Strategy: `cookie` (reuses Chrome login session)
- Product URLs: `/{JAN_CODE}.html` (13-digit barcode)
- Cart API: `POST /on/demandware.store/Sites-POL-Site/ja_JP/Cart-AddProduct`
- Search: `GET /search/?q={query}`
- Safety: All purchase steps pause before irreversible payment action
