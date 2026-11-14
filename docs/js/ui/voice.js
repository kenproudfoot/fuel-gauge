// Voice input through the Web Speech API, where the browser has it.
// iOS support is unreliable (especially from the Home Screen), so this is a
// convenience on top of the text field, which works with keyboard dictation.

const MESSAGES = {
  'not-allowed': "Microphone access is off for this app. Use the keyboard's dictation key instead.",
  'service-not-allowed': "Voice input isn't allowed here. Use the keyboard's dictation key instead.",
  'no-speech': "Didn't catch that. Try again, or use the keyboard's dictation key.",
  'audio-capture': "No microphone found. Use the keyboard's dictation key instead.",
  network: "Voice input needs a connection. Use the keyboard's dictation key instead.",
};
const FALLBACK = "Voice input isn't available right now. Use the keyboard's dictation key instead.";

/**
 * handlers: onInterim(text), onFinal(text), onError(message), onState(listening)
 * Returns { supported, toggle() }.
 */
export function createVoice({ onInterim, onFinal, onError, onState }) {
  const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!Recognition) return { supported: false, toggle() {} };

  let recognition = null;
  let listening = false;

  function start() {
    let heard = '';
    let error = null;
    try {
      recognition = new Recognition();
      recognition.lang = navigator.language || 'en-US';
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.maxAlternatives = 1;
      recognition.onresult = (event) => {
        let text = '';
        for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
        heard = text.trim();
        onInterim(heard);
      };
      recognition.onerror = (event) => {
        error = event.error;
      };
      recognition.onend = () => {
        listening = false;
        onState(false);
        if (heard) onFinal(heard);
        else if (error !== 'aborted') onError(MESSAGES[error || 'no-speech'] || FALLBACK);
      };
      recognition.start();
      listening = true;
      onState(true);
    } catch {
      listening = false;
      onState(false);
      onError(FALLBACK);
    }
  }

  return {
    supported: true,
    toggle() {
      if (listening) recognition.stop();
      else start();
    },
  };
}
