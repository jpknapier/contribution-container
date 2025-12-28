import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerGhost' | 'icon' | 'success';
type ButtonSize = 'sm' | 'md';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const base =
  'inline-flex items-center justify-center rounded font-bold transition focus:outline-none focus:ring-2 focus:ring-slate-300';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm',
  secondary: 'bg-slate-100 hover:bg-slate-200 text-slate-800',
  ghost: 'text-slate-700 hover:text-slate-900',
  danger: 'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200',
  dangerGhost: 'text-red-600 hover:text-red-700',
  icon: 'bg-blue-50 hover:bg-blue-100 text-blue-700',
  success: 'bg-green-600 hover:bg-green-700 text-white shadow-sm'
};

const sizes: Record<ButtonSize, string> = {
  sm: 'text-xs px-2 py-1',
  md: 'text-sm px-3 py-2'
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}) => {
  return (
    <button
      {...props}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`.trim()}
    />
  );
};
