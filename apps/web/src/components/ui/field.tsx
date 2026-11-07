"use client";

import { useId } from "react";
import type {
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

export { SelectField } from "./select-field.tsx";
export type { SelectFieldProps, SelectOption } from "./select-field.tsx";

type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
  trailing?: ReactNode;
};

export function TextField({
  label,
  hint,
  error,
  trailing,
  id,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & FieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <div className={`ui-field ${className}`}>
      <label htmlFor={fieldId}>
        {label}
        {props.required && <span className="ui-required"> (required)</span>}
      </label>
      <div className="ui-input-wrap" data-invalid={!!error}>
        <input
          {...props}
          id={fieldId}
          aria-invalid={!!error}
          aria-describedby={error || hint ? `${fieldId}-help` : undefined}
        />
        {trailing && <span className="ui-input-trailing">{trailing}</span>}
      </div>
      {(error || hint) && (
        <p
          id={`${fieldId}-help`}
          className={error ? "ui-field-error" : "ui-field-hint"}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  id,
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & Omit<FieldProps, "trailing">) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  return (
    <div className={`ui-field ${className}`}>
      <label htmlFor={fieldId}>
        {label}
        {props.required && <span className="ui-required"> (required)</span>}
      </label>
      <textarea
        {...props}
        id={fieldId}
        aria-invalid={!!error}
        aria-describedby={error || hint ? `${fieldId}-help` : undefined}
      />
      {(error || hint) && (
        <p
          id={`${fieldId}-help`}
          className={error ? "ui-field-error" : "ui-field-hint"}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
