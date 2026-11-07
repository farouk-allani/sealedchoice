"use client";

import * as Select from "@radix-ui/react-select";
import { useId, useRef, useState } from "react";
import { Icon } from "./icon.tsx";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type SelectFieldProps = {
  label: string;
  options: readonly SelectOption[];
  value: string;
  onValueChange?: (value: string) => void;
  id?: string;
  name?: string;
  form?: string;
  autoComplete?: string;
  hint?: string;
  error?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
};

export function SelectField({
  label,
  options,
  value,
  onValueChange,
  id,
  name,
  form,
  autoComplete,
  hint,
  error,
  placeholder = "Choose an option",
  disabled,
  required,
  className = "",
}: SelectFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const trigger = useRef<HTMLButtonElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(
    null,
  );
  const [nativeInvalid, setNativeInvalid] = useState(false);
  const fieldError =
    error ?? (nativeInvalid && !value ? "Choose an option." : undefined);
  const selected = options.find((option) => option.value === value);

  return (
    <div
      ref={setPortalContainer}
      className={`ui-field ui-select-field ${className}`.trim()}
      onInvalidCapture={(event) => {
        if (event.target instanceof HTMLSelectElement) {
          event.preventDefault();
          setNativeInvalid(true);
          trigger.current?.focus();
        }
      }}
    >
      <label id={`${fieldId}-label`} htmlFor={fieldId}>
        {label}
        {required && <span className="ui-required"> (required)</span>}
      </label>
      <Select.Root
        value={value}
        onValueChange={(next) => {
          setNativeInvalid(false);
          onValueChange?.(next);
        }}
        name={name}
        form={form}
        autoComplete={autoComplete}
        disabled={disabled}
        required={required}
      >
        <Select.Trigger
          ref={trigger}
          id={fieldId}
          className="ui-select-trigger"
          aria-labelledby={`${fieldId}-label`}
          aria-describedby={fieldError || hint ? `${fieldId}-help` : undefined}
          aria-invalid={!!fieldError}
          aria-required={required || undefined}
        >
          <Select.Value placeholder={placeholder}>
            {selected?.label}
          </Select.Value>
          <Select.Icon className="ui-select-chevron">
            <Icon name="chevron" size={20} />
          </Select.Icon>
        </Select.Trigger>
        {/* Keep the popup inside its field so it inherits paper/dark tokens and native dialog top-layer access. */}
        <Select.Portal container={portalContainer}>
          <Select.Content
            className="ui-select-content"
            position="popper"
            sideOffset={8}
            collisionPadding={12}
            aria-labelledby={`${fieldId}-label`}
            onEscapeKeyDown={(event) => event.stopPropagation()}
          >
            <Select.ScrollUpButton className="ui-select-scroll ui-select-scroll--up">
              <Icon name="chevron" size={18} />
            </Select.ScrollUpButton>
            <Select.Viewport className="ui-select-viewport">
              {options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  textValue={option.label}
                  className="ui-select-item"
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator className="ui-select-check">
                    <Icon name="check" size={19} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
            <Select.ScrollDownButton className="ui-select-scroll ui-select-scroll--down">
              <Icon name="chevron" size={18} />
            </Select.ScrollDownButton>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
      {(fieldError || hint) && (
        <p
          id={`${fieldId}-help`}
          className={fieldError ? "ui-field-error" : "ui-field-hint"}
          role={nativeInvalid && !value ? "alert" : undefined}
        >
          {fieldError ?? hint}
        </p>
      )}
    </div>
  );
}
