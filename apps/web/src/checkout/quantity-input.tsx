interface QuantityInputProps {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

export default function QuantityInput({
  value,
  disabled,
  onChange,
}: QuantityInputProps) {
  return (
    <div>
      <label htmlFor="quantity">Quantidade</label>
      <input
        id="quantity"
        name="quantity"
        type="number"
        min="1"
        step="1"
        inputMode="numeric"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}
