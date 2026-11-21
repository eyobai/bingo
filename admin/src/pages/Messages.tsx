import { useState } from 'react';
import { ApiError, api } from '../api';
import { Button, ErrorLine, Panel, field, useApi, useToast } from '../ui';

interface Status {
  id: number;
  total: number;
  sent: number;
  failed: number;
  done: boolean;
  startedAt: string;
  finishedAt: string | null;
}

const MAX_IMAGE = 5 * 1024 * 1024;

/** Promo messages to every player through the bot, e.g. "50% deposit bonus until 6 PM". */
export function Messages() {
  const toast = useToast();
  const info = useApi<{ audience: number; last: Status | null }>('/admin/broadcast', 2000);
  const [text, setText] = useState('');
  const [image, setImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const [playButton, setPlayButton] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const limit = image ? 1024 : 4000;
  const last = info.data?.last;
  const sending = last && !last.done;

  const pickImage = (file: File | undefined) => {
    if (!file) return setImage(null);
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return toast('Choose a JPG, PNG or WebP picture.', 'bad');
    if (file.size > MAX_IMAGE) return toast('The picture must be under 5 MB.', 'bad');
    const reader = new FileReader();
    reader.onload = () => setImage({ dataUrl: String(reader.result), name: file.name });
    reader.readAsDataURL(file);
  };

  const send = async (testOnly: boolean) => {
    setBusy(true);
    try {
      const r = await api<Status>('/admin/broadcast', {
        body: { text, imageBase64: image?.dataUrl, playButton, testOnly },
      });
      if (testOnly) toast(r.sent ? 'Sent to your Telegram. Check how it looks.' : 'Could not reach your Telegram. Open the bot and press Start first.', r.sent ? 'good' : 'bad');
      else {
        toast(`Sending to ${r.total} players…`);
        setConfirming(false);
      }
      await info.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : String(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Panel title="New message to all players">
        <ErrorLine error={info.error} />
        <form
          className="flex flex-col gap-4 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            setConfirming(true);
          }}
        >
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted" htmlFor="msg-text">
            Message
            <textarea
              id="msg-text"
              required
              rows={7}
              maxLength={limit}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className={field}
              placeholder={'🔥 50% deposit bonus until 6 PM today!\nDeposit 300 birr or more and get half of it as bonus.\n\n🔥 እስከ ምሽቱ 12 ሰዓት 50% ቦነስ!'}
            />
            <span className="font-normal">
              {text.length} / {limit} characters{image ? ' (Telegram allows less text under a picture)' : ''}. Emoji work.
            </span>
          </label>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-muted" htmlFor="msg-image">
              Picture (optional)
            </label>
            <input id="msg-image" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => pickImage(e.target.files?.[0])} className="text-sm" />
            {image && (
              <div className="flex items-start gap-3">
                <img src={image.dataUrl} alt="Selected picture" className="max-h-48 max-w-full rounded-lg border border-line" />
                <Button onClick={() => setImage(null)}>Remove</Button>
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm font-semibold" htmlFor="msg-play">
            <input id="msg-play" type="checkbox" checked={playButton} onChange={(e) => setPlayButton(e.target.checked)} className="h-4 w-4 accent-[var(--gold)]" />
            Add a "🎮 Play now" button under the message
          </label>

          {!confirming ? (
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || !text.trim() || text.length > limit} onClick={() => void send(true)}>
                Send a test to me
              </Button>
              <Button tone="primary" type="submit" disabled={busy || !text.trim() || text.length > limit || Boolean(sending)}>
                Send to all {info.data?.audience ?? ''} players…
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gold bg-gold-soft p-3 text-sm">
              <span className="font-semibold">Send this to {info.data?.audience} players now? It cannot be taken back.</span>
              <Button tone="primary" disabled={busy} onClick={() => void send(false)}>
                Yes, send
              </Button>
              <Button onClick={() => setConfirming(false)}>No</Button>
            </div>
          )}
          <p className="text-xs text-muted">
            Tip: send a test to yourself first. Players who never pressed Start in the bot, or blocked it, cannot receive messages; they are counted as not delivered.
            Do not promise winnings; describe bonuses and events.
          </p>
        </form>
      </Panel>

      {last && (
        <Panel title={last.done ? 'Last message' : 'Sending now…'}>
          <div className="flex flex-col gap-2 p-4">
            <div className="h-2 overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-valuemin={0} aria-valuemax={last.total} aria-valuenow={last.sent + last.failed}>
              <div className="h-full bg-[var(--gold)] transition-all" style={{ width: `${last.total ? ((last.sent + last.failed) / last.total) * 100 : 100}%` }} />
            </div>
            <p className="num text-sm">
              <b>{last.sent}</b> delivered · <b>{last.failed}</b> not delivered · {last.total} players
              {last.done && last.finishedAt ? ` · finished ${new Date(last.finishedAt).toLocaleTimeString()}` : ''}
            </p>
          </div>
        </Panel>
      )}
    </div>
  );
}
