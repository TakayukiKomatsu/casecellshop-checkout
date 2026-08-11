import type { ProductDto } from "../lib/api-types";

const priceFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

interface ProductListProps {
  products: ProductDto[];
  selectedProductId: string;
  disabled: boolean;
  onSelect: (productId: string) => void;
}

export default function ProductList({
  products,
  selectedProductId,
  disabled,
  onSelect,
}: ProductListProps) {
  return (
    <fieldset disabled={disabled}>
      <legend>Escolha uma capinha</legend>
      {products.length === 0 ? (
        <p>Nenhum produto disponível.</p>
      ) : (
        <ul>
          {products.map((product) => (
            <li key={product.id}>
              <label>
                <input
                  type="radio"
                  name="product"
                  value={product.id}
                  checked={selectedProductId === product.id}
                  onChange={() => onSelect(product.id)}
                />
                <span>
                  <strong>{product.name}</strong>
                  <span>{product.description}</span>
                  <span>{priceFormatter.format(product.priceCents / 100)}</span>
                  <span>{product.availableStock} em estoque</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
