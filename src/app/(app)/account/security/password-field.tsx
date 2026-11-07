/**
 * @file Password field for confirming a security change.
 */
import TextField from '@/components/ui/text-field';

/**
 * A "Current password" field, for changes Better Auth asks the user to
 * confirm (setting up an authenticator, new backup codes, turning off
 * two-step verification).
 *
 * @param props - Field props.
 * @param props.value - The password typed so far.
 * @param props.onChange - Called with the new value.
 * @returns The field.
 */
export default function PasswordField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <TextField
      label="Current password"
      type="password"
      name="password"
      autoComplete="current-password"
      description="To keep your account safe, confirm it's you."
      required
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
