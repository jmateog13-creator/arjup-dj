/* ═══════════════════════════════════════════════════════════════
   i18n · CATALÀ — tots els strings docents de AULATECH DJ.

   Regla del contracte (§12.5): els termes de taula queden en ANGLÈS
   (PLAY, CUE, SYNC, GAIN, LOW/MID/HIGH, LOOP, FX, crossfader…) —
   idèntics a VirtualDJ. Tota la capa docent (lliçons, reptes,
   overlay, tooltips propis) passa per aquest diccionari.

   API:
     import { ca, t } from '../i18n/ca.js';
     t('lessons.l1.title')            → string
     t('modes.stepOf', { n: 2, total: 4 }) → interpolació {var}
═══════════════════════════════════════════════════════════════ */

export const ca = {

  // ─── UI general docent ─────────────────────────────────────
  app: {
    title          : 'ARJUP DJ',
    activateAudio  : 'Activa l’àudio',
    activateHint   : 'Toca per despertar la taula. Cap so abans del teu gest.',
    loadLocal      : 'Carrega àudio local',
    analyzing      : 'Analitzant pista… (BPM i forma d’ona)',
    dropToLoad     : 'Deixa anar la pista al deck',
    recStart       : 'Grava la teva mescla',
    recStop        : 'Atura la gravació i descarrega',
    midiLearn      : 'Mode MIDI Learn: toca un control de pantalla i mou el del teu controlador',
    lockedControl  : 'Aquest control està bloquejat en aquesta lliçó',
  },

  // ─── Selector de modes + overlay (ModesFacade) ─────────────
  modes: {
    academy        : 'Acadèmia',
    lab            : 'Laboratori',
    sandbox        : 'Sandbox',
    academyDesc    : '8 lliçons guiades: de zero a la teva primera transició completa.',
    labDesc        : '15 reptes per demostrar que domines la taula.',
    sandboxDesc    : 'Taula lliure: carrega la teva música, connecta un controlador MIDI i grava.',
    done           : 'Fet!',
    next           : 'Endavant',
    stepOf         : 'Pas {n} de {total}',
    stepDone       : 'Molt bé!',
    lessonComplete : 'Lliçó completada!',
    challengeStart : 'Comença el repte',
    challengeHold  : 'Aguanta-ho…',
    challengeDone  : 'Repte superat!',
    locked         : 'Bloquejat',
    replay         : 'Repeteix',
    chooseLesson   : 'Tria una lliçó',
    chooseChallenge: 'Tria un repte',
    chooseExample  : 'Tria una sessió',
    exampleLoaded  : 'Sessió carregada. La taula és teva.',
    progressSaved  : 'Progrés desat',
  },

  // ─── ACADÈMIA · 8 lliçons ──────────────────────────────────
  lessons: {

    l1: {
      title: 'La taula i el deck',
      s1: {
        text: 'Benvingut/da a la cabina! Això que veus és una taula de DJ professional: dos decks (A i B), un mixer al mig i el browser de música a sota. Quan estiguis a punt, prem «Fet!».',
        hint: 'Observa la pantalla: tot el que aprendràs aquí funciona igual a VirtualDJ de veritat.',
      },
      s2: {
        text: 'Primer pas de tot DJ: posar música al deck. Fes doble clic a una pista del browser (o arrossega-la) per carregar-la al deck A.',
        hint: 'El browser és la llista de la part de baix. El deck A és el de l’esquerra, el blau.',
      },
      s3: {
        text: 'Pista carregada! Ara prem PLAY al deck A i escolta. Fixa’t com gira el jog i com avança la forma d’ona.',
        hint: 'PLAY és el botó gran de transport del deck A. També pots fer servir la barra espaiadora.',
      },
      s4: {
        text: 'Ara atura-la: torna a prémer PLAY (fa de pausa, com a VDJ). Controlar quan sona i quan calla és la base de tot.',
        hint: 'El mateix botó PLAY alterna entre reproduir i pausar.',
      },
      s5: {
        text: 'Perfecte! Ja saps carregar i disparar música. A la propera lliçó descobriràs el botó més important del DJ: el CUE.',
        hint: null,
      },
    },

    l2: {
      title: 'El punt CUE',
      s1: {
        text: 'El punt CUE és la teva marca de sortida: el lloc exacte on vols que comenci la pista. Els DJs el posen just on entra el ritme. Prem «Fet!» per començar.',
        hint: 'A VirtualDJ, CUE es fixa amb la pista en pausa.',
      },
      s2: {
        text: 'Amb la pista en PAUSA, mou-te per la pista (clica la mini forma d’ona o arrossega el jog) fins a un punt que t’agradi i prem CUE per fixar-hi la marca. Després prem «Fet!».',
        hint: 'CUE en pausa = fixar el punt. Busca l’inici d’un beat: les marques del beatgrid t’ajuden.',
      },
      s3: {
        text: 'Ara prem PLAY i deixa que la pista avanci uns segons.',
        hint: 'Deixa-la córrer: volem allunyar-nos del punt CUE per veure la màgia.',
      },
      s4: {
        text: 'I ara la màgia: prem CUE. La pista s’atura i torna d’un salt al teu punt exacte. Això és el que fa que un DJ mai es perdi.',
        hint: 'CUE durant la reproducció = stop + tornar al punt. Si el mantens premut, sona des del punt mentre l’aguantis (preview).',
      },
      s5: {
        text: 'Dominat! CUE és el teu punt de retorn segur. Següent parada: els Hot Cues, quatre marques instantànies més.',
        hint: null,
      },
    },

    l3: {
      title: 'Els Hot Cues',
      s1: {
        text: 'Els HOT CUES són 4 memòries instantànies: intro, entrada del baix, tornada, break… Un clic i hi saltes a l’instant, fins i tot amb la pista sonant. Prem «Fet!».',
        hint: 'Són els 4 botons numerats sota el transport del deck.',
      },
      s2: {
        text: 'Posa la pista sonant (o en pausa) al punt que vulguis i prem el HOT CUE 1 buit: quedarà gravat allà. Fes el mateix amb el HOT CUE 2 en un altre punt.',
        hint: 'Botó buit = fixa la marca. Tria dos moments diferents de la cançó.',
      },
      s3: {
        text: 'Ara juga-hi: amb la pista sonant, prem HOT CUE 1 i HOT CUE 2 alternativament. Estàs fent «cue juggling», una tècnica real de DJ!',
        hint: 'Botó ple = salta a la marca. Shift+clic l’esborra, com a VDJ.',
      },
      s4: {
        text: 'Genial! Amb CUE i els HOT CUES ja et mous per la pista com un professional. Ara toca el so: GAIN i equalitzador.',
        hint: null,
      },
    },

    l4: {
      title: 'GAIN i EQ — talla els greus!',
      s1: {
        text: 'Cada canal del mixer té GAIN (volum d’entrada) i tres bandes d’EQ: LOW (greus), MID (mitjos) i HIGH (aguts). Són les eines per esculpir el so. Posa la pista del deck A a sonar.',
        hint: 'Els knobs del mixer central, columna del deck A.',
      },
      s2: {
        text: 'Mou el knob GAIN del canal A i escolta com canvia el volum. Torna’l a deixar a prop del centre: el GAIN serveix per igualar pistes, no per apujar-ho tot.',
        hint: 'Regla d’or: el VU meter ha de ballar pel verd, sense clavar-se al vermell.',
      },
      s3: {
        text: 'Ara el moviment estrella dels DJs: TALLA ELS GREUS. Gira el knob LOW del canal A del tot avall (o fes-hi doble clic: kill). Escolta com la cançó es queda sense fonament.',
        hint: 'Doble clic al knob LOW = kill instantani (−∞). El LED vermell t’ho confirma.',
      },
      s4: {
        text: 'I ara retorna els greus: puja LOW altra vegada al centre. Sents el cop d’energia? Aquest gest, treure i tornar els greus, és el cor de totes les transicions.',
        hint: 'Doble clic altre cop desfà el kill, o gira el knob al centre.',
      },
      s5: {
        text: 'EQ dominat! Recorda: dues cançons alhora amb tots els greus = fang sonor. Per això sempre es talla el LOW de la que entra o de la que surt.',
        hint: null,
      },
    },

    l5: {
      title: 'El crossfader i la primera transició',
      s1: {
        text: 'El CROSSFADER és el fader horitzontal del mig: reparteix el so entre el deck A (esquerra) i el deck B (dreta). Primer, carrega una pista al deck B.',
        hint: 'Doble clic o arrossega una pista del browser cap al deck B, el vermell.',
      },
      s2: {
        text: 'Mou el crossfader del tot a l’esquerra: només s’ha de sentir el deck A. Posa el deck A a sonar.',
        hint: 'Crossfader a l’esquerra = 100% deck A.',
      },
      s3: {
        text: 'Ara prem PLAY al deck B. No pateixis: amb el crossfader a l’esquerra, el públic no el sent. Això és tenir la següent cançó «preparada».',
        hint: 'Els dos decks sonen internament, però el crossfader decideix què surt pels altaveus.',
      },
      s4: {
        text: 'LA TEVA PRIMERA TRANSICIÓ: llisca el crossfader a poc a poc cap a la dreta, fins al final. La cançó A s’esvaeix i la B pren el relleu.',
        hint: 'Fes-ho lent i suau: 4 o 8 compassos. La corba equal-power fa que el volum total no caigui pel mig.',
      },
      s5: {
        text: 'Ho has fet! Acabes de mesclar dues cançons. Però potser has notat que els ritmes no anaven junts… Això ho arreglem a la propera lliçó: beatmatching.',
        hint: null,
      },
    },

    l6: {
      title: 'Beatmatching manual',
      s1: {
        text: 'BEATMATCHING: fer que les dues cançons vagin exactament al mateix tempo i amb els cops alineats. És l’habilitat sagrada del DJ. Carrega pistes als dos decks i posa’ls a sonar.',
        hint: 'Tria dues pistes amb BPM propers (per exemple 124 i 126): és molt més fàcil.',
      },
      s2: {
        text: 'Mira els BPM dels dos decks. Mou el PITCH del deck B (el fader vertical de la dreta del deck) fins que el seu BPM efectiu iguali el del deck A, amb un marge de ±0.1.',
        hint: 'PITCH avall = més ràpid? No! Com a VDJ: fader avall = accelera (+), amunt = frena (−). El LED verd del pitch s’encén quan hi ets.',
      },
      s3: {
        text: 'Mateixa velocitat no vol dir mateixos cops: potser van desfasats. Fes servir el JOG del deck B (arrossega’l suaument) per empènyer o frenar la pista fins que els bombos sonin com UN de sol.',
        hint: 'Mira les dues ones de dalt: quan les marques de beat coincideixen visualment, els bombos van junts.',
      },
      s4: {
        text: 'Impressionant: acabes de fer beatmatching manual, com es feia amb vinils. Ara ja et pots guanyar el dret a prémer SYNC.',
        hint: null,
      },
    },

    l7: {
      title: 'SYNC i loops',
      s1: {
        text: 'El botó SYNC fa el beatmatching per tu: iguala BPM i alinea la fase d’un sol cop. Ara que ja saps fer-ho a mà, tens permís per usar-lo. Amb els dos decks sonant, prem SYNC al deck B.',
        hint: 'SYNC pren el deck A com a mestre i hi ajusta el B.',
      },
      s2: {
        text: 'Ara els LOOPS: repeticions perfectes tallades al beatgrid. Al deck A, activa un LOOP de 4 beats. La pista quedarà girant en un cicle d’un compàs.',
        hint: 'Botonera LOOP del deck A: prem el «4». Els límits cauen exactes al grid, per això mai sona tallat.',
      },
      s3: {
        text: 'Prova mides: canvia el loop a 8 beats (més ampli) o a 1 beat (hipnòtic). Escolta com canvia la tensió musical. Quan acabis, prem «Fet!».',
        hint: 'Cada botó re-talla el loop des del mateix punt d’inici.',
      },
      s4: {
        text: 'I ara allibera’l: prem EXIT i la pista continua el seu camí com si res. Loop + EXIT és una manera perfecta d’allargar un final mentre prepares l’entrada de l’altra cançó.',
        hint: 'EXIT desactiva el loop sense salts: la reproducció segueix des d’on és.',
      },
      s5: {
        text: 'SYNC i loops a la butxaca. Últim nivell: els FX i la transició completa de DJ professional.',
        hint: null,
      },
    },

    l8: {
      title: 'FX i la transició completa',
      s1: {
        text: 'Última lliçó: ho ajuntem TOT. Prepara l’escenari: pista sonant al deck A, pista carregada al deck B, crossfader a l’esquerra.',
        hint: 'Com al final d’una cançó real: el públic balla amb A i tu prepares B.',
      },
      s2: {
        text: 'Prem PLAY al B i SYNC perquè vagi clavat amb l’A. Després, TALLA ELS GREUS del deck B: que entri sense fonament, només amb mitjos i aguts.',
        hint: 'Doble clic al LOW del canal B = kill. Recordes la lliçó 4? Dos baixos alhora = fang.',
      },
      s3: {
        text: 'Toc d’artista: activa un FX al deck A (per exemple ECHO) i puja-li el wet. L’eco farà que la sortida de la cançó A soni gran i espacial.',
        hint: 'Rack FX del deck A: tria l’efecte, botó ON, i knob DRY/WET cap amunt.',
      },
      s4: {
        text: 'LA TRANSICIÓ: mou el crossfader cap a la dreta durant uns 8 compassos i, quan siguis a l’altra banda, INTERCANVIA els baixos: retorna el LOW del B i talla el del A si encara sona.',
        hint: 'Crossfader fins al final de la dreta. El moment de l’intercanvi de greus ÉS la transició.',
      },
      s5: {
        text: 'Enhorabona, DJ! Has fet una transició completa: sync, kill de greus, FX i crossfader. Ara demostra-ho al Laboratori: 15 reptes t’hi esperen.',
        hint: null,
      },
    },
  },

  // ─── LABORATORI · 15 reptes ────────────────────────────────
  challenges: {
    c01: {
      title: 'Primer contacte',
      desc : 'Carrega una pista a un deck i fes-la sonar. Mantén-la sonant per superar el repte.',
    },
    c02: {
      title: 'Gain de referència',
      desc : 'Amb una pista sonant, deixa el GAIN a prop del centre (0.9–1.1) i el channel fader ben amunt. So net, sense saturar.',
    },
    c03: {
      title: 'Kill de greus',
      desc : 'Amb una pista sonant, talla els greus del tot: LOW en kill (doble clic o knob a mínim).',
    },
    c04: {
      title: 'Silenci per bandes',
      desc : 'Mata les TRES bandes d’EQ (LOW, MID i HIGH) d’un deck sonant. La cançó gairebé desapareix… i tot torna quan les alliberes.',
    },
    c05: {
      title: 'Escombrat de filtre',
      desc : 'Porta el knob FILTER d’un deck sonant ben lluny del centre i aguanta-l’hi almenys 2 segons. Lowpass o highpass, tu tries el color.',
    },
    c06: {
      title: 'Tres Hot Cues',
      desc : 'Marca com a mínim 3 HOT CUES en una mateixa pista: intro, entrada de baix, tornada… on tu vulguis.',
    },
    c07: {
      title: 'Loop de 4 beats',
      desc : 'Activa un LOOP de 4 beats en una pista sonant i deixa’l girar. Un compàs perfecte, tallat al beatgrid.',
    },
    c08: {
      title: 'Doble loop',
      desc : 'Els dos decks sonant i TOTS DOS amb un loop actiu alhora. Dues rodes girant a la vegada.',
    },
    c09: {
      title: 'BPM a prop',
      desc : 'Amb els dos decks sonant, ajusta el PITCH fins que els BPM efectius quedin a menys de 0.5 BPM de distància. Sense SYNC no val… però no ho podem vigilar: honor de DJ.',
    },
    c10: {
      title: 'Beatmatch de precisió',
      desc : 'El repte sagrat: BPM efectius a ±0.1 i fases alineades (els bombos, junts). Pitch + jog o SYNC: aquí ja t’ho has guanyat.',
    },
    c11: {
      title: 'Echo al beat',
      desc : 'Activa l’efecte ECHO en un deck sonant amb el DRY/WET almenys al 40%. Escolta com les cues repeteixen al tempo.',
    },
    c12: {
      title: 'Beat Roll',
      desc : 'Dispara un BEAT ROLL en un deck sonant amb el wet a mig o més. El tros es repeteix en bucle mentre la pista continua per sota.',
    },
    c13: {
      title: 'Creuament complet',
      desc : 'Amb els dos decks sonant, fes viatjar el crossfader d’una banda a l’altra (recorregut gairebé complet) en els últims 12 segons.',
    },
    c14: {
      title: 'Transició sense xoc de greus',
      desc : 'La transició de veritat: creua el crossfader sencer i que en cap moment sonin els greus dels dos decks alhora. Kill i intercanvi, com un professional.',
    },
    c15: {
      title: 'La sessió del mestre',
      desc : 'Gran final: amb REC gravant, fes una transició completa entre els dos decks sense xoc de greus. La teva primera mescla enregistrada.',
    },
  },

  // ─── SANDBOX · 5 sessions d’exemple ───────────────────────
  examples: {
    e1: {
      title: 'Sessió house 124',
      desc : 'El clàssic: house a 124 BPM sonant al deck A i la següent, a 126, carregada i a punt al deck B. Tot a zero: comença tu la festa.',
    },
    e2: {
      title: 'Transició a mig fer — acaba-la tu',
      desc : 'T’agafem a mitja feina: els dos decks sonant, sincronitzats, greus del B tallats i crossfader a mig camí. Acaba la transició amb elegància.',
    },
    e3: {
      title: 'El regne del baix (100 BPM)',
      desc : 'Groove lent a 100 BPM amb un loop de 4 beats girant al deck A i el filtre a mig escombrat. Juga amb LOW i FILTER: aquí mana el baix.',
    },
    e4: {
      title: 'Energia 140',
      desc : 'Ritme ràpid: 140 BPM amb hot cues ja marcats i l’ECHO armat al deck B. Practica salts de hot cue i cues amb eco.',
    },
    e5: {
      title: 'Downtempo 87',
      desc : 'Sessió tranquil·la a 87 BPM per practicar sense presses: pitch, jog i transicions llargues. Ideal per gravar la teva primera mescla.',
    },
  },
};

/**
 * t('a.b.c', { x: 1 }) — resol una clau amb punts i interpola {x}.
 * Si la clau no existeix, retorna la pròpia clau (mai peta la UI).
 */
export function t(path, vars = null) {
  let node = ca;
  for (const part of path.split('.')) {
    node = node?.[part];
    if (node === undefined) return path;
  }
  if (typeof node !== 'string') return path;
  if (!vars) return node;
  return node.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

export default ca;
