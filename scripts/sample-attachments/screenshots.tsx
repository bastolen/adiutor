/**
 * @file The sample screenshots, drawn when the seed runs (`screen.tsx`):
 * Alpha's checkout failing after a payment and the staff's chart of it, the
 * email that still bills Alpha's old address, the opening hours on the test
 * site the sample reply links to, a test page that came out blank, and
 * Beta's newsletter form that does nothing. Names and addresses are the
 * test data's own (Adiutor Tests, `adiutor.test`).
 */
import {
  DAY,
  dayText,
  MINUTE,
  OLD_ADDRESS,
  type SampleFile,
  timeText,
  yearOf,
  ZONE,
} from './files';
import { BrowserWindow, drawScreenshot, INK, SiteHeader, SplitLine } from './screen';

/** The order whose confirmation failed in the checkout samples. */
const FAILED_ORDER = 'AL-48213';

/**
 * Alpha's shop after a customer paid: the confirmation page gives up with
 * "Something went wrong", with the order summary under it.
 *
 * @param at - When the request was raised.
 * @returns The file.
 */
export async function checkoutError(at: Date): Promise<SampleFile> {
  const steps = ['Cart', 'Details', 'Payment', 'Confirmation'];
  const failedAt = new Date(at.getTime() - 25 * MINUTE);
  const bytes = await drawScreenshot(
    <BrowserWindow
      title="Checkout | Adiutor Tests Alpha"
      url={`https://alpha.adiutor.test/checkout/complete?order=${FAILED_ORDER}`}
    >
      <SiteHeader
        name="Adiutor Tests Alpha"
        colour={INK.alpha}
        links={['Coffee', 'Tea', 'Equipment', 'Cart (0)']}
      />
      <div style={{ display: 'flex', flexDirection: 'column', padding: '32px 64px', gap: 28 }}>
        <div style={{ display: 'flex', gap: 14, fontSize: 16 }}>
          {steps.map((step, place) => (
            <div
              key={step}
              style={{
                display: 'flex',
                padding: '6px 14px',
                borderRadius: 14,
                background: place === steps.length - 1 ? INK.dangerWash : INK.wash,
                color: place === steps.length - 1 ? INK.danger : INK.muted,
              }}
            >
              {`${place + 1}. ${step}`}
            </div>
          ))}
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: '24px 28px',
            border: '1px solid #f3b8b2',
            borderRadius: 10,
            background: INK.dangerWash,
          }}
        >
          <div style={{ display: 'flex', fontSize: 30, color: INK.danger }}>
            Something went wrong
          </div>
          <div style={{ display: 'flex', fontSize: 19, color: '#7a271a' }}>
            We couldn’t show your order confirmation. Please try again in a few minutes.
          </div>
          <div style={{ display: 'flex', fontSize: 15, color: INK.danger }}>
            {`Error reference 7F3A-21C9 · ${timeText(failedAt)}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 32 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: 560,
              padding: '20px 24px',
              border: `1px solid ${INK.line}`,
              borderRadius: 10,
            }}
          >
            <div style={{ display: 'flex', fontSize: 20, marginBottom: 8 }}>
              {`Order ${FAILED_ORDER}`}
            </div>
            <SplitLine left="Espresso beans, 1 kg" right="€ 24.95" strong={false} />
            <SplitLine left="Oat milk, pack of 6" right="€ 13.50" strong={false} />
            <SplitLine left="Shipping" right="€ 4.95" strong={false} />
            <SplitLine left="Total paid" right="€ 43.40" strong />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 8 }}>
            <div
              style={{
                display: 'flex',
                padding: '14px 26px',
                borderRadius: 8,
                background: INK.alpha,
                color: '#ffffff',
                fontSize: 18,
              }}
            >
              Back to the shop
            </div>
            <div style={{ display: 'flex', fontSize: 16, color: INK.muted }}>
              Questions? Mail shop@adiutor.test
            </div>
          </div>
        </div>
      </div>
    </BrowserWindow>,
  );
  return { name: 'checkout-error.png', bytes };
}

/**
 * The staff's monitoring of Alpha's checkout: order confirmations that
 * failed per hour, for the eight hours before the note.
 *
 * @param at - When the note was written.
 * @returns The file.
 */
export async function failedCheckouts(at: Date): Promise<SampleFile> {
  const failed = [0, 0, 1, 0, 0, 12, 23, 19];
  const scale = 30;
  const chartHeight = 360;
  const hours = failed.map((count, place) => ({
    count,
    label: timeText(new Date(at.getTime() - (failed.length - place) * 60 * MINUTE)).replace(
      /:\d\d$/,
      ':00',
    ),
  }));
  const total = failed.reduce((sum, count) => sum + count, 0);
  const stats = [
    { label: 'Payments received', value: '214' },
    { label: 'Confirmations failed', value: String(total) },
    { label: 'Failure rate', value: `${((total / 214) * 100).toFixed(1)}%` },
  ];
  const bytes = await drawScreenshot(
    <BrowserWindow
      title="Checkout | Monitoring"
      url="https://monitor.adiutor.test/companies/alpha/checkout"
    >
      <div style={{ display: 'flex', flexDirection: 'column', padding: '28px 48px', gap: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', fontSize: 28 }}>Adiutor Tests Alpha · checkout</div>
          <div style={{ display: 'flex', fontSize: 17, color: INK.muted }}>
            Order confirmations that failed, per hour
          </div>
        </div>
        <div style={{ display: 'flex', gap: 20 }}>
          {stats.map((stat) => (
            <div
              key={stat.label}
              style={{
                display: 'flex',
                flexDirection: 'column',
                width: 240,
                padding: '14px 18px',
                border: `1px solid ${INK.line}`,
                borderRadius: 10,
              }}
            >
              <div style={{ display: 'flex', fontSize: 15, color: INK.muted }}>{stat.label}</div>
              <div style={{ display: 'flex', fontSize: 30 }}>{stat.value}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', position: 'relative', height: chartHeight }}>
            {[30, 20, 10, 0].map((line) => (
              <div
                key={line}
                style={{
                  display: 'flex',
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: chartHeight - (line / scale) * chartHeight,
                  borderTop: `1px solid ${line === 0 ? INK.muted : INK.line}`,
                  fontSize: 13,
                  color: INK.muted,
                }}
              >
                {String(line)}
              </div>
            ))}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: 34,
                height: chartHeight,
                paddingLeft: 44,
              }}
            >
              {hours.map((hour) => (
                <div
                  key={hour.label}
                  style={{
                    display: 'flex',
                    width: 86,
                    height: Math.max(2, (hour.count / scale) * chartHeight),
                    borderRadius: '6px 6px 0 0',
                    background: hour.count > 5 ? INK.danger : '#f5a097',
                  }}
                />
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 34, paddingLeft: 44, paddingTop: 10 }}>
            {hours.map((hour) => (
              <div
                key={hour.label}
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  width: 86,
                  fontSize: 14,
                  color: INK.muted,
                }}
              >
                {hour.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </BrowserWindow>,
  );
  return { name: 'failed-checkouts.png', bytes };
}

/**
 * The email that carries an invoice to Alpha, in a mail client: the invoice
 * itself is right now, but the email still bills the old address.
 *
 * @param at - When the reply was written.
 * @returns The file.
 */
export async function invoiceEmail(at: Date): Promise<SampleFile> {
  const sent = new Date(at.getTime() - 2 * DAY);
  const number = `${yearOf(sent)}-1203`;
  const folders = [
    { name: 'Inbox', count: '3' },
    { name: 'Starred', count: '' },
    { name: 'Sent', count: '' },
    { name: 'Archive', count: '' },
  ];
  const bytes = await drawScreenshot(
    <BrowserWindow title="Inbox | Mail" url="https://mail.adiutor.test/inbox">
      <div style={{ display: 'flex', flexGrow: 1 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: 210,
            padding: '24px 14px',
            gap: 4,
            background: INK.wash,
            borderRight: `1px solid ${INK.line}`,
          }}
        >
          {folders.map((folder, place) => (
            <div
              key={folder.name}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '9px 12px',
                borderRadius: 8,
                background: place === 0 ? '#dbe7f5' : 'transparent',
                fontSize: 16,
              }}
            >
              <div style={{ display: 'flex' }}>{folder.name}</div>
              <div style={{ display: 'flex', color: INK.muted }}>{folder.count}</div>
            </div>
          ))}
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            padding: '26px 40px',
            gap: 18,
          }}
        >
          <div style={{ display: 'flex', fontSize: 26 }}>
            {`Your invoice ${number} from Adiutor Tests`}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 44,
                height: 44,
                borderRadius: 22,
                background: INK.alpha,
                color: '#ffffff',
                fontSize: 17,
              }}
            >
              AT
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
              <div style={{ display: 'flex', fontSize: 17 }}>
                Adiutor Tests &lt;billing@adiutor.test&gt;
              </div>
              <div style={{ display: 'flex', fontSize: 15, color: INK.muted }}>to Avery Alpha</div>
            </div>
            <div style={{ display: 'flex', fontSize: 15, color: INK.muted }}>
              {`${dayText(sent)}, ${timeText(sent)}`}
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              fontSize: 18,
              lineHeight: 1.45,
            }}
          >
            <div style={{ display: 'flex' }}>Hi Avery,</div>
            <div style={{ display: 'flex' }}>
              {`Attached is invoice ${number}. We’ll collect the amount of € 433.79 within 14 days.`}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', color: INK.muted }}>Billed to</div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignSelf: 'flex-start',
                  padding: '4px 8px',
                  background: '#fef08a',
                }}
              >
                <div style={{ display: 'flex' }}>Adiutor Tests Alpha</div>
                {OLD_ADDRESS.map((line) => (
                  <div key={line} style={{ display: 'flex' }}>
                    {line}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex' }}>Kind regards, Adiutor Tests</div>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              alignSelf: 'flex-start',
              gap: 12,
              padding: '10px 16px',
              border: `1px solid ${INK.line}`,
              borderRadius: 8,
              fontSize: 16,
            }}
          >
            <div
              style={{
                display: 'flex',
                padding: '3px 7px',
                borderRadius: 4,
                background: INK.danger,
                color: '#ffffff',
                fontSize: 12,
              }}
            >
              PDF
            </div>
            <div style={{ display: 'flex' }}>{`invoice-${number}.pdf`}</div>
            <div style={{ display: 'flex', color: INK.muted }}>2 KB</div>
          </div>
        </div>
      </div>
    </BrowserWindow>,
  );
  return { name: 'invoice-email.png', bytes };
}

/**
 * The first day of the month after a date's, in the samples' zone, at noon
 * UTC (the same day there).
 *
 * @param date - The date.
 * @returns The first of next month.
 */
function firstOfNextMonth(date: Date): Date {
  const parts = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'numeric',
    timeZone: ZONE,
  }).formatToParts(date);
  /**
   * One part of the date, as a number.
   *
   * @param type - The part.
   * @returns Its value.
   */
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((found) => found.type === type)?.value);
  // The month is counted from 1 here and from 0 by Date.UTC, so this is the next one.
  return new Date(Date.UTC(part('year'), part('month'), 1, 12));
}

/**
 * Alpha's opening hours page on the test site, before it's published.
 *
 * @param at - When the reply was written.
 * @returns The file.
 */
export async function openingHoursPreview(at: Date): Promise<SampleFile> {
  const nextMonth = firstOfNextMonth(at);
  const hours = [
    { day: 'Monday to Thursday', time: '08:30 – 17:30' },
    { day: 'Friday', time: '08:30 – 16:00' },
    { day: 'Saturday', time: '10:00 – 16:00' },
    { day: 'Sunday', time: 'Closed' },
  ];
  const bytes = await drawScreenshot(
    <BrowserWindow
      title="Opening hours | Adiutor Tests Alpha"
      url="https://adiutor.dev/preview/opening-hours"
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '8px 0',
          background: '#fef3c7',
          color: '#92400e',
          fontSize: 15,
        }}
      >
        Preview · not published yet
      </div>
      <SiteHeader
        name="Adiutor Tests Alpha"
        colour={INK.alpha}
        links={['Shop', 'About us', 'Opening hours', 'Contact']}
      />
      <div style={{ display: 'flex', flexDirection: 'column', padding: '36px 120px', gap: 20 }}>
        <div style={{ display: 'flex', fontSize: 40, letterSpacing: -0.5 }}>Opening hours</div>
        <div style={{ display: 'flex', fontSize: 19, color: INK.muted }}>
          {`From ${dayText(nextMonth)}`}
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            border: `1px solid ${INK.line}`,
            borderRadius: 10,
          }}
        >
          {hours.map((row, place) => (
            <div
              key={row.day}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '16px 24px',
                borderTop: place === 0 ? 'none' : `1px solid ${INK.line}`,
                fontSize: 20,
              }}
            >
              <div style={{ display: 'flex' }}>{row.day}</div>
              <div style={{ display: 'flex', color: row.time === 'Closed' ? INK.muted : INK.text }}>
                {row.time}
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', fontSize: 17, color: INK.muted }}>
          We’re closed on public holidays. Questions? Mail shop@adiutor.test
        </div>
      </div>
    </BrowserWindow>,
  );
  return { name: 'opening-hours-preview.png', bytes };
}

/**
 * A photo of what the printer on floor 2 prints: a test page that came out
 * almost blank, with faint streaks, on a desk.
 *
 * @returns The file.
 */
export async function blankTestPage(): Promise<SampleFile> {
  const streaks = [92, 141, 198, 266, 301, 388, 452];
  const bytes = await drawScreenshot(
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        background: 'linear-gradient(160deg, #9a7b5f, #6f553f)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          width: 560,
          height: 790,
          padding: '48px 56px',
          background: 'linear-gradient(180deg, #fbfbf7, #f1f0ea)',
          boxShadow: '0 18px 36px rgba(0, 0, 0, 0.35)',
          transform: 'rotate(-3deg)',
        }}
      >
        <div style={{ display: 'flex', fontSize: 22, color: '#ecebe6' }}>Printer test page</div>
        <div style={{ display: 'flex', fontSize: 14, color: '#efeee9', marginTop: 6 }}>
          FLOOR2-PRINTER · A4 · 600 dpi
        </div>
        {streaks.map((left) => (
          <div
            key={left}
            style={{
              display: 'flex',
              position: 'absolute',
              top: 0,
              bottom: 0,
              left,
              width: left % 2 === 0 ? 2 : 3,
              background: 'rgba(120, 120, 120, 0.12)',
            }}
          />
        ))}
      </div>
    </div>,
  );
  return { name: 'test-page.png', bytes };
}

/**
 * Beta's home page with its newsletter form filled in and Subscribe
 * pressed, and the browser's console showing why nothing happens.
 *
 * @returns The file.
 */
export async function signUpForm(): Promise<SampleFile> {
  const bytes = await drawScreenshot(
    <BrowserWindow title="Adiutor Tests Beta" url="https://beta.adiutor.test/">
      <SiteHeader
        name="Adiutor Tests Beta"
        colour={INK.beta}
        links={['Products', 'Stories', 'About us']}
      />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          flexGrow: 1,
          padding: '40px 0',
          gap: 14,
          background: '#f0fdfa',
        }}
      >
        <div style={{ display: 'flex', fontSize: 36, letterSpacing: -0.5 }}>
          News from Adiutor Tests Beta
        </div>
        <div style={{ display: 'flex', fontSize: 19, color: INK.muted }}>
          Once a month, never more. Sign up below.
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: 560,
            marginTop: 12,
            padding: 24,
            gap: 10,
            borderRadius: 12,
            background: '#ffffff',
            boxShadow: '0 4px 16px rgba(15, 23, 42, 0.08)',
          }}
        >
          <div style={{ display: 'flex', fontSize: 16 }}>Email address</div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                flexGrow: 1,
                height: 48,
                padding: '0 14px',
                border: `1px solid ${INK.line}`,
                borderRadius: 8,
                fontSize: 18,
              }}
            >
              multi@adiutor.test
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                height: 48,
                padding: '0 24px',
                borderRadius: 8,
                background: INK.beta,
                boxShadow: '0 0 0 3px #99f6e4',
                color: '#ffffff',
                fontSize: 18,
              }}
            >
              Subscribe
            </div>
          </div>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: 230,
          background: '#202124',
          color: '#e8eaed',
          fontSize: 15,
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 26,
            padding: '10px 16px',
            borderBottom: '1px solid #3c4043',
            color: '#9aa0a6',
          }}
        >
          <div style={{ display: 'flex' }}>Elements</div>
          <div style={{ display: 'flex', color: '#8ab4f8' }}>Console</div>
          <div style={{ display: 'flex' }}>Network</div>
          <div style={{ display: 'flex' }}>Sources</div>
        </div>
        <div style={{ display: 'flex', padding: '10px 16px 0', color: '#9aa0a6' }}>
          Navigated to https://beta.adiutor.test/
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            margin: '10px 0',
            padding: '10px 16px',
            background: '#290000',
            color: '#f28b82',
          }}
        >
          <div style={{ display: 'flex' }}>
            Uncaught TypeError: Cannot read properties of null (reading
            &apos;addEventListener&apos;)
          </div>
          <div style={{ display: 'flex', paddingLeft: 24 }}>at newsletter.js:42:18</div>
        </div>
      </div>
    </BrowserWindow>,
  );
  return { name: 'sign-up-form.png', bytes };
}
