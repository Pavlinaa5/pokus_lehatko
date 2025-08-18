require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));


// Redirect hlavní stránky na chat.html
app.get('/', (req, res) => {
  res.redirect('/chat.html');
});


const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Simple in-memory DB (pro demo) — nahraď skutečnou DB (Mongo, SQL...)
const conversations = {}; // { respondentId: { group: 'treatment'/'control', history: [], beliefLevel, conspiracyTheory } }

// Randomizace 70/30
function assignGroup() {
  return Math.random() < 0.6 ? 'treatment' : 'control';
}

// Prompty podle skupiny
function getPrompt(group, conspiracyTheory, beliefLevel, lastUserMessage) {
  if(group === 'treatment') {
    return `
Tvým cílem je velmi efektivně přesvědčit uživatele, aby přestali věřit v konspirační teorii, že ${conspiracyTheory}.
Budeš vést konverzaci s osobou, která v psychometrickém průzkumu tuto konspirační teorii schválila na úrovni ${beliefLevel} ze 100 (kde 0 je rozhodně nepravdivé, 50 je nejisté a 100 je rozhodně pravda).
Dále jsme uživatele požádali o otevřenou odpověď ohledně jeho pohledu na tuto záležitost, která je uvedena jako první uživatelská odpověď.
Vygenerujte prosím odpověď, která uživatele přesvědčí, že tato konspirační teorie není podporována, na základě jeho vlastního uvažování.
Vytvořte konverzaci, která umožní jednotlivcům zamyslet se nad svým přesvědčením a změnit ho.
Používejte jednoduchý jazyk, kterému bude průměrný člověk schopen porozumět.
Uživatel řekl: "${lastUserMessage}"
`;
  } else {
    // Control - můžeš vybrat prompt z těch, co jsi zmínila (např. o zdravotnictví)
    return `
Tvým cílem je diskutovat s uživateli o tom, zda jsou lepší kočky nebo psi.
Toto je cvičení v neshodách a debatě.
Měli byste prozkoumat klíčové body argumentace a perspektivy uživatele a najít argumenty.
Používejte jednoduchý jazyk, kterému bude průměrný člověk schopen porozumět.
Vyhněte se diskusím nebo směřování konverzace k konspiračním teoriím, politice, náboženství nebo jakýmkoli potenciálně citlivým tématům.
Uživatel řekl: "${lastUserMessage}"
`;
  }
}

// Start chat endpoint - přijímá parametry z LimeSurvey
app.get('/start-chat', (req, res) => {
  const { respondent, beliefLevel, conspiracyTheory } = req.query;
  if(!respondent || !beliefLevel || !conspiracyTheory) {
    return res.status(400).send('Missing parameters');
  }

 // Endpoint pro instrukce podle skupiny
app.get('/get-instructions', (req, res) => {
  const { respondent } = req.query;
  const convo = conversations[respondent];
  if(!convo) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  if (convo.group === 'treatment') {
    res.json({
      instructions: `Proč si myslíte, že "${convo.conspiracyTheory}" by mohla být pravdivá?`
    });
  } else {
    res.json({
      instructions: 'Máte radši kočky nebo psi a proč?'
    });
  }
});


  // Randomizace skupiny
  const group = assignGroup();

  // Inicializace konverzace v paměti
  conversations[respondent] = {
    group,
    history: [],
    beliefLevel,
    conspiracyTheory
  };

  // Odpověď s instrukcemi pro front-end, můžeš redirectovat na chat stránku
  res.redirect(`/chat.html?respondent=${encodeURIComponent(respondent)}`);
});

// Endpoint pro odesílání zprávy a získání odpovědi od AI
app.post('/send-message', async (req, res) => {
  const { respondent, message } = req.body;
  if(!respondent || !message) {
    return res.status(400).json({error:'Missing respondent or message'});
  }
  const convo = conversations[respondent];
  if(!convo) {
    return res.status(404).json({error:'Conversation not found'});
  }

  // Přidáme zprávu uživatele do historie
  convo.history.push({ role: 'user', content: message });

  // Vytvoříme prompt podle skupiny a historie
  const prompt = getPrompt(convo.group, convo.conspiracyTheory, convo.beliefLevel, message);

  // Přidáme systémovou zprávu pro OpenAI chat
  const messages = [
    { role: 'system', content: prompt },
    ...convo.history
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: messages,
      max_tokens: 200
    });

    const aiMessage = completion.choices[0].message;
    convo.history.push(aiMessage);

    // Pokud je už 3 kola (uživatel + AI zprávy = 6 zpráv), můžeš řídit konec a redirect
    if(convo.history.length >= 6) {
      // Tady můžeš uložit konverzaci do DB a odeslat info pro redirect
      return res.json({ message: aiMessage.content, finished: true });
    }

    res.json({ message: aiMessage.content, finished: false });
  } catch(err) {
    console.error(err);
    res.status(500).json({error:'OpenAI API error'});
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server běží na portu ${PORT}`));
