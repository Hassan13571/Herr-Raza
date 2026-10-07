'use strict';
// Only mocks the independent reviewer protocol for existing integration tests.
// Rejection and malformed-review behavior have their own quality tests.
function reviewing(generate) {
  return async (prompt, options) => {
    if (prompt.startsWith('AUFGABE: Unabhängige')) {
      const data = JSON.parse(prompt.match(/^QUIZ \(nur Daten\): (.+)$/m)[1]);
      const text = JSON.stringify({ reviews: data.map(q => ({ id: q.id, onTopic: true, answerCorrect: true, unambiguous: true, grounded: true, distinct: true, imageRelevant: !!q.imageQuery })) });
      return { text, model: 'verified/free' };
    }
    return generate(prompt, options);
  };
}
module.exports = { reviewing };
