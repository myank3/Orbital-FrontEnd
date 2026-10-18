/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { LegalLayout, type LegalSection } from '../components/LegalLayout';

const SECTIONS: LegalSection[] = [
  { id: 'who', title: 'Who can use Orbital' },
  { id: 'account', title: 'Your account' },
  { id: 'use', title: 'Acceptable use' },
  { id: 'content', title: 'Your content' },
  { id: 'our-content', title: 'Our content' },
  { id: 'third-party', title: 'Third-party services' },
  { id: 'availability', title: 'Availability' },
  { id: 'liability', title: 'Limitation of liability' },
  { id: 'termination', title: 'Termination' },
  { id: 'changes', title: 'Changes to these Terms' },
  { id: 'law', title: 'Governing law' },
  { id: 'contact', title: 'Contact' },
];

export default function Terms(): React.JSX.Element {
  return (
    <LegalLayout
      title="Terms of Service"
      subtitle="The agreement between you and Orbital. Plain language, no tricks."
      lastUpdated="17 October 2026"
      sections={SECTIONS}
    >
      <p>
        By creating an account or using Orbital (the &quot;Service&quot;), you
        agree to these Terms of Service. If you do not agree, please do not use
        the Service.
      </p>

      <h2 id="who">1. Who can use Orbital</h2>
      <p>
        You must be at least <strong>13 years old</strong>. If you are under 18,
        you must have permission from a parent or guardian. You must not be
        barred from using the Service under the laws of your country.
      </p>

      <h2 id="account">2. Your account</h2>
      <ul>
        <li>You are responsible for keeping your password safe.</li>
        <li>You are responsible for everything done through your account.</li>
        <li>
          You must provide accurate information — a real email address and an
          honest display name.
        </li>
        <li>
          One account per person. Do not create accounts to evade a ban.
        </li>
        <li>
          We may suspend or terminate accounts that violate these Terms, as
          described in Section 9.
        </li>
      </ul>

      <h2 id="use">3. Acceptable use</h2>
      <p>
        You agree <strong>not</strong> to:
      </p>
      <ul>
        <li>Harass, threaten, or abuse other users.</li>
        <li>Send spam or unsolicited bulk messages.</li>
        <li>
          Post or send content that is illegal, sexually exploitative of minors,
          or that incites violence.
        </li>
        <li>Impersonate another person or misrepresent your identity.</li>
        <li>Attempt to access other users&apos; accounts.</li>
        <li>Reverse-engineer, scrape, or attack the Service.</li>
        <li>Use the Service to distribute malware or phishing links.</li>
        <li>Violate anyone&apos;s intellectual property rights.</li>
      </ul>
      <p>
        If you see content that violates these rules, please{' '}
        <a href="mailto:prolium7@outlook.com">contact support</a> to report it.
        We take reports seriously.
      </p>

      <h2 id="content">4. Your content</h2>
      <p>
        <strong>You own your messages, files, and profile content.</strong> We
        do not claim ownership of anything you create.
      </p>
      <p>
        By using the Service, you grant us a limited license to store, transmit,
        and display your content{' '}
        <em>
          solely to operate the Service for you and the people you are
          communicating with
        </em>
        . We do not use your content for advertising, and we do not sell it to
        anyone.
      </p>
      <p>
        If you delete your content, we delete it from our servers within 30
        days, except where backups still contain it. Backups are purged on a
        90-day cycle.
      </p>

      <h2 id="our-content">5. Our content</h2>
      <p>
        The Orbital name, logo, code, and design are ours. You may not copy,
        modify, or redistribute them without permission. Content shown in Signal
        Corner (movies, news) belongs to its respective owners — we link to it,
        we do not claim it.
      </p>

      <h2 id="third-party">6. Third-party services</h2>
      <p>
        Orbital uses Google Sign-In (optional), Brevo (email delivery), Vercel
        (frontend hosting), and MonsterASP (backend hosting). When you use
        features that involve these services, their terms also apply. We are not
        responsible for the actions of third-party services.
      </p>

      <h2 id="availability">7. Availability — &quot;as is&quot;</h2>
      <p>
        Orbital is provided <strong>&quot;as is&quot;</strong> and{' '}
        <strong>&quot;as available.&quot;</strong> We do not promise it will be
        up 100% of the time, error-free, or that data will never be lost. Back
        up anything important. We may change, suspend, or discontinue the
        Service at any time, though we will give reasonable notice for material
        changes.
      </p>

      <h2 id="liability">8. Limitation of liability</h2>
      <p>
        To the maximum extent allowed by law, we are not liable for indirect,
        incidental, or consequential damages; lost messages, lost data, or lost
        profits; the actions of other users; or third-party outages or breaches.
      </p>
      <p>
        Our total liability to you is limited to the amount you have paid us in
        the last 12 months — which, on the free tier, is $0.
      </p>

      <h2 id="termination">9. Termination</h2>
      <p>
        <strong>You can stop using Orbital at any time.</strong> Delete your
        account by{' '}
        <a href="mailto:prolium7@outlook.com">contacting support</a>; we process
        deletions within 30 days.
      </p>
      <p>
        <strong>We can suspend or terminate your account</strong> if you violate
        these Terms, if required by law, or if we discontinue the Service. We
        will tell you why, unless legally prevented from doing so.
      </p>

      <h2 id="changes">10. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. Material changes will be
        announced in the application at least 14 days before they take effect.
        Continuing to use Orbital after that date constitutes acceptance of the
        new Terms.
      </p>

      <h2 id="law">11. Governing law</h2>
      <p>
        These Terms are governed by the laws of <strong>India</strong>. Disputes
        will be resolved in the courts of Delhi, India. If any provision of
        these Terms is found unenforceable, the remaining provisions will remain
        in full force and effect.
      </p>

      <h2 id="contact">12. Contact</h2>
      <p>
        Questions about these Terms?{' '}
        <a href="mailto:prolium7@outlook.com">Contact support</a>.
      </p>
    </LegalLayout>
  );
}