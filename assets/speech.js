(function install(root) {
  'use strict';
  const letters = ['Ah', 'Be', 'Zeh', 'De'];
  function segments(question, answers) {
    return [{ text: question, label: 'Frage' }, ...answers.flatMap((text, index) => [
      { text: 'Antwort ' + letters[index] + '.', label: 'Antwort ' + String.fromCharCode(65 + index) },
      { text, label: 'Antwort ' + String.fromCharCode(65 + index) }
    ])];
  }
  function createReader(options = {}) {
    const synthesis = options.synthesis || root.speechSynthesis;
    const Utterance = options.Utterance || root.SpeechSynthesisUtterance;
    const later = options.setTimer || root.setTimeout.bind(root);
    const clear = options.clearTimer || root.clearTimeout.bind(root);
    let playing = false, generation = 0, timer = null, current = null;
    const state = label => options.onState?.(playing, label || '');
    function stop() {
      generation++;
      if (timer !== null) clear(timer);
      timer = null;
      playing = false;
      synthesis?.cancel();
      current = null;
      state();
    }
    function read(question, answers) {
      stop();
      if (!synthesis || !Utterance) {
        options.onError?.('Dieser Browser unterstützt kein Vorlesen.');
        return;
      }
      const list = segments(question, answers), run = generation;
      const voices = synthesis.getVoices();
      const voice = voices.find(v => /^de[-_]DE$/i.test(v.lang) && v.localService)
        || voices.find(v => /^de[-_]DE$/i.test(v.lang))
        || voices.find(v => /^de\b/i.test(v.lang));
      playing = true;
      function say(index) {
        if (run !== generation) return;
        if (index >= list.length) { playing = false; current = null; state(); return; }
        current = new Utterance(list[index].text);
        current.lang = 'de-DE';
        current.rate = 0.9;
        if (voice) current.voice = voice;
        current.onend = () => { if (run === generation) timer = later(() => say(index + 1), index % 2 ? 180 : 260); };
        current.onerror = event => {
          if (run !== generation || event.error === 'canceled' || event.error === 'interrupted') return;
          stop();
          options.onError?.('Das Vorlesen ist unterbrochen. Bitte erneut starten.');
        };
        state(list[index].label);
        synthesis.speak(current);
      }
      synthesis.resume?.();
      say(0);
    }
    return { read, stop, get playing() { return playing; } };
  }
  const api = { segments, createReader, browserSource: () => '(' + install.toString() + ')(globalThis);' };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RazaSpeech = api;
})(typeof globalThis === 'object' ? globalThis : this);
