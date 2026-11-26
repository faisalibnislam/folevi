"use client";
// Settings > Writing: Folevi's own spell check and next-word prediction (docs/SPELLING_PLAN.md), American or
// British English, and the personal dictionary (words added, words ignored), all following the person to
// every device (convex/spelling.ts). Each note also has its own spell check switch (the note's right-click
// menu, Spelling and prediction).
import { useId } from "react";
import { BookA, SpellCheck2, Sparkles, X } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { useIphoneLook } from "@/lib/iphone";
import { ChoiceRow, IosSection, SwitchRow } from "@/components/iphone/SettingsKit";
import { RowIcon } from "@/components/iphone/Grouped";
import { usePersonalWords, useSetSpellingSettings, useSpellingSettings } from "@/components/editor/SpellingSync";
import { removePersonalWord, type WordKind } from "@/lib/spelling/settings";
import { Card } from "./Card";

const LANGS = "English (American or British), Spanish, French, German, Portuguese, Indonesian, Hindi, Bengali and Arabic; Chinese gets prediction only";
const PREDICT_HELP = "Gray words after the caret, learnt on this device from what you write. Press Tab to take one, Esc to dismiss. With Foli AI on, longer suggestions come after a pause (never for encrypted notes).";

function WordList({ kind, words, label }: { kind: WordKind; words: string[]; label: string }) {
  if (!words.length) return <p className="text-footnote text-muted">None yet.</p>;
  return (
    <ul aria-label={label} className="flex flex-wrap gap-1.5">
      {words.map((w) => (
        <li key={w} className="inline-flex items-center gap-1 rounded-chip border border-line bg-surface px-2 py-0.5 text-callout text-ink" dir="auto">
          {w}
          <button type="button" aria-label={`Remove ${w}`} title={`Remove ${w}`} className="rounded-tiny p-0.5 text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus" onClick={() => removePersonalWord(w, kind)}>
            <X size={12} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function WritingSection() {
  const s = useSpellingSettings();
  const save = useSetSpellingSettings();
  const words = usePersonalWords();
  const iphone = useIphoneLook();
  const spellHint = useId();
  const predictHint = useId();
  const englishId = useId();
  if (iphone) {
    return (
      <>
        <IosSection footer={`Red underlines under misspelt words, with suggestions. ${LANGS}.`}>
          <SwitchRow icon={<RowIcon><SpellCheck2 /></RowIcon>} label="Check spelling" checked={s.spellcheck} onChange={(spellcheck) => save({ spellcheck })} />
          <ChoiceRow
            screen="spelling-english"
            label="English"
            icon={<RowIcon><BookA /></RowIcon>}
            value={s.english}
            choices={[
              { value: "en-US", label: "American English" },
              { value: "en-GB", label: "British English" },
            ]}
            onChange={(english) => save({ english })}
          />
        </IosSection>
        <IosSection footer={PREDICT_HELP}>
          <SwitchRow icon={<RowIcon><Sparkles /></RowIcon>} label="Predict next words" checked={s.predictions} onChange={(predictions) => save({ predictions })} />
        </IosSection>
        <IosSection header="Your dictionary">
          <div className="px-4 py-3">
            <WordList kind="learnt" words={words.learnt} label="Words added to your dictionary" />
          </div>
        </IosSection>
        <IosSection header="Ignored words">
          <div className="px-4 py-3">
            <WordList kind="ignored" words={words.ignored} label="Ignored words" />
          </div>
        </IosSection>
      </>
    );
  }
  return (
    <>
      <Card title="Spelling and prediction" description="Folevi's own spell check and next words, the same in every app and offline. Your settings follow you to all your devices.">
        <div className="max-w-xl divide-y divide-line/70">
          <div className="flex items-center justify-between gap-6 py-3 first:pt-0">
            <span className="min-w-0">
              <span className="block text-subheadline text-ink">Check spelling</span>
              <span id={spellHint} className="block text-footnote text-muted">
                Red underlines under misspelt words, with suggestions. {LANGS}. Each note can turn it off in its right-click menu.
              </span>
            </span>
            <Switch checked={s.spellcheck} onChange={(spellcheck) => save({ spellcheck })} label="Check spelling" describedBy={spellHint} />
          </div>
          <div className="flex items-center justify-between gap-6 py-3">
            <span className="min-w-0">
              <span id={englishId} className="block text-subheadline text-ink">
                English
              </span>
              <span className="block text-footnote text-muted">Which spelling English notes are checked against.</span>
            </span>
            <Select value={s.english} onChange={(e) => save({ english: e.target.value as "en-US" | "en-GB" })} aria-labelledby={englishId} className="ui-input h-control w-44 flex-none px-3 text-callout">
              <option value="en-US">American English</option>
              <option value="en-GB">British English</option>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-6 py-3 last:pb-0">
            <span className="min-w-0">
              <span className="block text-subheadline text-ink">Predict next words</span>
              <span id={predictHint} className="block text-footnote text-muted">
                {PREDICT_HELP}
              </span>
            </span>
            <Switch checked={s.predictions} onChange={(predictions) => save({ predictions })} label="Predict next words" describedBy={predictHint} />
          </div>
        </div>
      </Card>
      <Card title="Your dictionary" description="Words you added with Add to dictionary. They're never underlined and are offered as suggestions. Words from encrypted notes stay on the device they were added on.">
        <WordList kind="learnt" words={words.learnt} label="Words added to your dictionary" />
      </Card>
      <Card title="Ignored words" description="Words you chose to ignore: never underlined.">
        <WordList kind="ignored" words={words.ignored} label="Ignored words" />
      </Card>
    </>
  );
}
