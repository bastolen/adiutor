/**
 * @file The heading of the invitation and invite link pages: the company's
 * avatar, "Join <company>" and the role being offered.
 */
import Avatar from '@/components/ui/avatar';

/**
 * Props for {@link InvitationHeading}.
 */
interface InvitationHeadingProps {
  /** The company the person is invited to. */
  companyName: string;
  /** The role label they'd get, e.g. "Admin". */
  roleLabel: string;
}

/**
 * The company's avatar, the page's `h1` and what the invitation offers.
 *
 * @param props - Heading props.
 * @param props.companyName - The company.
 * @param props.roleLabel - The role label.
 * @returns The heading block.
 */
export default function InvitationHeading({ companyName, roleLabel }: InvitationHeadingProps) {
  return (
    <div className="flex flex-col gap-3">
      <Avatar name={companyName} size="lg" brand />
      <h1 className="text-2xl font-semibold text-foreground">Join {companyName}</h1>
      <p className="text-sm text-muted-foreground">
        You&apos;ve been invited to join {companyName} on Adiutor as {roleLabel}.
      </p>
    </div>
  );
}
