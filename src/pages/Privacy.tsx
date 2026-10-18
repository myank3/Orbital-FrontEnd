/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { LegalLayout, type LegalSection } from '../components/LegalLayout';

const SECTIONS: LegalSection[] = [
  { id: 'collect', title: 'What we collect' },
  { id: 'not-collect', title: 'What we do NOT collect' },
  { id: 'why', title: 'Why we collect it' },
  { id: 'share', title: 'Who we share data with' },
  { id: 'where', title: 'Where your data is stored' },
  { id: 'retention', title: 'How long we keep it' },
  { id: 'rights', title: 'Your rights' },
  { id: 'children', title: 'Children' },
  { id: 'security', title: 'Security' },
  { id: 'changes', title: 'Changes' },
  { id: 'contact', title: 'Contact' },
];

export default function Privacy(): React.JSX.Element {
  return (
    <LegalLayout
      title="Privacy Policy"
      subtitle="What Orbital does with your data — and what it doesn't."
      lastUpdated="17 October 2026"
      sections={SECTIONS}
    >
      <p>
       This Privacy Policy explains what personal data we
        collect, why we collect it, how we use it, and the rights you have over
        it. If you have questions about this policy, please{' '}
        <a href="mailto:prolium7@outlook.com">contact support</a>.
      </p>

      <p>
        By creating an account or using the Service, you acknowledge that you
        have read and understood this Privacy Policy.
      </p>

      <h2 id="collect">1. What we collect</h2>

      <h3>1.1 Information you give us</h3>
      <ul>
        <li>
          <strong>Account information:</strong> email address, display name,
          handle (in the form <code>@you@orbit</code>), password (stored only as
          a bcrypt hash — we never see or store your plain password), and an
          optional profile photo.
        </li>
        <li>
          <strong>Messages and content:</strong> direct messages, group
          messages, call metadata (participants, start time, end time,
          duration — <em>not</em> call audio or video content), files and images
          you send, and group names.
        </li>
        <li>
          <strong>Friend and block relationships:</strong> who you have added as
          a friend, who you have blocked, and who has requested to connect with
          you.
        </li>
      </ul>

      <h3>1.2 Information we collect automatically</h3>
      <ul>
        <li>IP address and approximate location (country level only).</li>
        <li>
          Device information: browser type, operating system, device type, and
          application version.
        </li>
        <li>
          Usage data: pages viewed, features used, timestamps, and error logs.
        </li>
        <li>
          Authentication data: a short-lived JWT stored in your browser and a
          refresh token stored in a secure, HTTP-only cookie.
        </li>
      </ul>

      <h3>1.3 Information from third parties</h3>
      <ul>
        <li>
          <strong>Google Sign-In:</strong> if you choose to sign in with Google,
          we receive your name and email address from Google.
        </li>
        <li>
          <strong>Brevo:</strong> our email delivery provider notifies us when
          emails we send are delivered and, if you click a link in one of our
          emails, that you clicked it.
        </li>
      </ul>

      <h2 id="not-collect">2. What we do NOT collect</h2>
      <ul>
        <li>We do not sell your personal data. Ever.</li>
        <li>We do not display advertising. Ever.</li>
        <li>
          We do not use third-party analytics that track you across other
          websites.
        </li>
        <li>
          We do not access the content of your messages for advertising
          purposes. We may access message content only when: (a) you report a
          specific message as abuse, (b) we are required to do so by a valid
          legal order, or (c) it is necessary to diagnose and fix a bug you have
          reported to us.
        </li>
      </ul>

      <h2 id="why">3. Why we collect it</h2>
      <p>
        Where the EU General Data Protection Regulation (GDPR) applies, we rely
        on the following legal bases for each processing activity:
      </p>
      <table>
        <thead>
          <tr>
            <th>Purpose</th>
            <th>Legal basis</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Creating and operating your account</td>
            <td>Contract</td>
          </tr>
          <tr>
            <td>Delivering messages, calls, and files</td>
            <td>Contract</td>
          </tr>
          <tr>
            <td>Preventing spam, abuse, and fraud</td>
            <td>Legitimate interest</td>
          </tr>
          <tr>
            <td>Fixing bugs and improving the Service</td>
            <td>Legitimate interest</td>
          </tr>
          <tr>
            <td>
              Sending transactional emails (account verification, password
              reset)
            </td>
            <td>Contract</td>
          </tr>
          <tr>
            <td>Complying with legal obligations</td>
            <td>Legal obligation</td>
          </tr>
        </tbody>
      </table>

      <h2 id="share">4. Who we share data with</h2>
      <p>
        We do not sell your data. We share it only with service providers who
        help us run Orbital, and only the data they need to perform their
        function:
      </p>
      <ul>
        <li>
          <strong>Vercel</strong> (edge delivery) —{' '}
          <a
            href="https://vercel.com/legal/privacy-policy"
            target="_blank"
            rel="noopener noreferrer"
          >
            vercel.com/legal/privacy-policy
          </a>
        </li>
        
        <li>
          <strong>Brevo</strong> (transactional email delivery) —{' '}
          <a
            href="https://www.brevo.com/legal/privacypolicy/"
            target="_blank"
            rel="noopener noreferrer"
          >
            brevo.com/legal/privacypolicy
          </a>
        </li>
        <li>
          <strong>Google</strong> (optional sign-in) —{' '}
          <a
            href="https://policies.google.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
          >
            policies.google.com/privacy
          </a>
        </li>
      </ul>
      <p>
        We may also disclose data where required by law, court order, or to
        prevent imminent harm to a person.
      </p>

      <h2 id="where">5. Where your data is stored</h2>
      <p>
        Our backend is hosted on ASP.Net in{' '}
        <strong>the Netherlands</strong>. Our frontend is hosted by Vercel, which
        serves from multiple global edge locations. If you are located in the
        EU or UK, your data may be transferred to and processed in countries
        outside the EU/UK. Where this occurs, we rely on standard contractual
        clauses approved by the European Commission for these transfers.
      </p>

      <h2 id="retention">6. How long we keep your data</h2>
      <ul>
        <li>
          <strong>Account data:</strong> retained until you delete your account.
        </li>
        <li>
          <strong>Messages:</strong> retained until you or the other party
          deletes them, or until you delete your account.
        </li>
        <li>
          <strong>Server logs:</strong> retained for 30 days.
        </li>
        <li>
          <strong>Backups:</strong> retained for 90 days, then permanently
          deleted.
        </li>
      </ul>
      <p>
        When you delete your account, we delete your account data and messages
        within 30 days. Some data — for example, fraud prevention records — may
        be retained longer where the law requires it.
      </p>

      <h2 id="rights">7. Your rights</h2>
      <p>
        Depending on where you live, you may have the following rights over your
        personal data:
      </p>
      <ul>
        <li>Access a copy of your data.</li>
        <li>Correct inaccurate data.</li>
        <li>Delete your account and associated data.</li>
        <li>Export your data in a machine-readable format.</li>
        <li>
          Object to processing based on legitimate interest, or request that we
          restrict such processing.
        </li>
        <li>
          Lodge a complaint with your local data protection authority if you
          believe we have handled your data unlawfully.
        </li>
      </ul>
      <p>
        To exercise any of these rights, please{' '}
        <a href="mailto:prolium7@outlook.com">contact support</a>. We respond to
        all verified requests within 30 days.
      </p>

      <h2 id="children">8. Children</h2>
      <p>
        Orbital is not intended for anyone under the age of 13. If you believe a
        child under 13 has created an account, please{' '}
        <a href="mailto:prolium7@outlook.com">contact support</a> and we will
        delete the account promptly.
      </p>

      <h2 id="security">9. Security</h2>
      <p>
        We use HTTPS for all traffic, encrypt passwords with bcrypt, encrypt the
        database at rest, and enforce rate limiting on authentication endpoints.
        No system is perfectly secure. If you discover a vulnerability, please{' '}
        <a href="mailto:prolium7@outlook.com">contact support</a> before
        disclosing it publicly so we can address it responsibly.
      </p>

      <h2 id="changes">10. Changes to this policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Material changes
        will be announced in the application and, where appropriate, by email at
        least 14 days before they take effect. Continuing to use the Service
        after that date constitutes acceptance of the revised policy.
      </p>

      <h2 id="contact">11. Contact</h2>
      <p>
        <strong>Contact:</strong>{' '}
        <a href="mailto:prolium7@outlook.com">Contact support</a>
      </p>
      <p>
        <strong>Data controller:</strong> Mayank
        <br />
        <strong>Jurisdiction:</strong> Delhi, India
      </p>
    </LegalLayout>
  );
}