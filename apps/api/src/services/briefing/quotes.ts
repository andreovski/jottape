// Ditado do dia: frases curadas de várias tradições, sempre com o autor ou a origem.
// A ordem do dia é `(dia * QUOTE_STRIDE) % tamanho`; o passo é primo com o tamanho, então
// percorre tudo sem repetir e alterna as tradições. Se a lista mudar de tamanho, confira o passo.

export type Quote = { text: string; author: string };

export const quotes: Quote[] = [
  { text: 'Devagar se vai ao longe.', author: 'Ditado popular brasileiro' },
  {
    text: 'Água mole em pedra dura, tanto bate até que fura.',
    author: 'Ditado popular brasileiro',
  },
  { text: 'Quem não arrisca não petisca.', author: 'Ditado popular brasileiro' },
  { text: 'De grão em grão, a galinha enche o papo.', author: 'Ditado popular brasileiro' },
  { text: 'Mais vale um pássaro na mão do que dois voando.', author: 'Ditado popular brasileiro' },
  { text: 'Quem planta colhe.', author: 'Ditado popular brasileiro' },
  { text: 'Não deixe para amanhã o que pode fazer hoje.', author: 'Ditado popular brasileiro' },
  { text: 'Cada dia com a sua agonia.', author: 'Ditado popular brasileiro' },
  { text: 'Antes tarde do que nunca.', author: 'Ditado popular brasileiro' },
  { text: 'A pressa é inimiga da perfeição.', author: 'Ditado popular brasileiro' },
  { text: 'Quem espera sempre alcança.', author: 'Ditado popular brasileiro' },
  { text: 'Deus ajuda quem cedo madruga.', author: 'Ditado popular brasileiro' },
  { text: 'Uma andorinha só não faz verão.', author: 'Ditado popular brasileiro' },
  { text: 'Em boca fechada não entra mosquito.', author: 'Ditado popular brasileiro' },
  { text: 'O seguro morreu de velho.', author: 'Ditado popular brasileiro' },
  { text: 'Quem tem boca vai a Roma.', author: 'Ditado popular brasileiro' },
  { text: 'Pouco a pouco se vai ao longe.', author: 'Ditado popular brasileiro' },
  { text: 'Quem guarda tem.', author: 'Ditado popular brasileiro' },
  { text: 'Mais vale prevenir do que remediar.', author: 'Ditado popular brasileiro' },
  { text: 'Roupa suja se lava em casa.', author: 'Ditado popular brasileiro' },
  { text: 'Depois da tempestade vem a bonança.', author: 'Ditado popular brasileiro' },
  { text: 'Gentileza gera gentileza.', author: 'Ditado popular brasileiro' },
  { text: 'Quem semeia vento colhe tempestade.', author: 'Ditado popular brasileiro' },
  { text: 'O hábito faz o monge.', author: 'Ditado popular brasileiro' },
  { text: 'Tudo tem seu tempo.', author: 'Ditado popular brasileiro' },
  { text: 'Errar é humano.', author: 'Ditado popular brasileiro' },
  { text: 'Saco vazio não para em pé.', author: 'Ditado popular brasileiro' },
  { text: 'Nem tudo que reluz é ouro.', author: 'Ditado popular brasileiro' },
  { text: 'Quem procura acha.', author: 'Ditado popular brasileiro' },
  { text: 'A união faz a força.', author: 'Ditado popular brasileiro' },
  { text: 'Para bom entendedor, meia palavra basta.', author: 'Ditado popular brasileiro' },
  { text: 'Você tem direito à ação, mas não aos frutos da ação.', author: 'Bhagavad Gita 2.47' },
  {
    text: 'Eleve-se pelo próprio esforço; não se rebaixe.',
    author: 'Bhagavad Gita 6.5 (trad. livre)',
  },
  {
    text: 'A mente é amiga de quem a domina e inimiga de quem não a domina.',
    author: 'Bhagavad Gita 6.6 (trad. livre)',
  },
  { text: 'Levante-se, desperte e não pare até atingir o objetivo.', author: 'Swami Vivekananda' },
  {
    text: 'A fé é o pássaro que sente a luz e canta quando a madrugada ainda está escura.',
    author: 'Rabindranath Tagore',
  },
  {
    text: 'A força não vem da capacidade física, mas de uma vontade indomável.',
    author: 'Mahatma Gandhi',
  },
  {
    text: 'Uma jornada de mil milhas começa com um único passo.',
    author: 'Lao Tsé, Tao Te Ching 64',
  },
  {
    text: 'Quem conhece os outros é sábio; quem conhece a si mesmo é iluminado.',
    author: 'Lao Tsé, Tao Te Ching 33',
  },
  { text: 'Quem sabe que tem o suficiente é rico.', author: 'Lao Tsé, Tao Te Ching 33' },
  { text: 'O mais suave do mundo vence o mais duro.', author: 'Lao Tsé, Tao Te Ching 43' },
  {
    text: 'Aprender sem refletir é inútil; refletir sem aprender é perigoso.',
    author: 'Confúcio, Analectos 2.15',
  },
  {
    text: 'Ao ver um homem bom, procure imitá-lo; ao ver um mau, examine a si mesmo.',
    author: 'Confúcio, Analectos 4.17',
  },
  {
    text: 'Saber o que se sabe e o que não se sabe: isso é conhecimento.',
    author: 'Confúcio, Analectos 2.17',
  },
  {
    text: 'Não faça aos outros o que não quer que façam a você.',
    author: 'Confúcio, Analectos 15.24',
  },
  { text: 'Não importa quão devagar você vá, desde que não pare.', author: 'Atribuído a Confúcio' },
  {
    text: 'Conheça o inimigo e conheça a si mesmo; em cem batalhas, nunca estará em perigo.',
    author: 'Sun Tzu, A Arte da Guerra',
  },
  { text: 'A felicidade perfeita é a ausência de busca por felicidade.', author: 'Zhuangzi' },
  {
    text: 'O melhor momento para plantar uma árvore foi há vinte anos. O segundo melhor é agora.',
    author: 'Provérbio chinês',
  },
  { text: 'Caia sete vezes, levante-se oito.', author: 'Provérbio japonês' },
  { text: 'Visão sem ação é um sonho; ação sem visão é um pesadelo.', author: 'Provérbio japonês' },
  { text: 'Não siga os passos dos antigos; busque o que eles buscaram.', author: 'Matsuo Bashō' },
  { text: 'Não faça nada que seja inútil.', author: 'Miyamoto Musashi, Dokkōdō' },
  { text: 'Estudar o caminho é estudar a si mesmo.', author: 'Dōgen, Genjōkōan' },
  { text: 'Quando comer, coma. Quando dormir, durma.', author: 'Provérbio zen' },
  {
    text: 'A mente precede todos os estados; a mente é a chefe, tudo é feito pela mente.',
    author: 'Buda, Dhammapada 1',
  },
  { text: 'O ódio nunca cessa com ódio; só cessa com amor.', author: 'Buda, Dhammapada 5' },
  {
    text: "Mesmo uma gota d'água, caindo aos poucos, enche um pote.",
    author: 'Buda, Dhammapada 122',
  },
  {
    text: 'Você mesmo deve fazer o esforço; os Budas apenas apontam o caminho.',
    author: 'Buda, Dhammapada 276',
  },
  {
    text: 'Não há caminho para a felicidade; a felicidade é o caminho.',
    author: 'Thich Nhat Hanh',
  },
  { text: 'A ferida é o lugar por onde a luz entra em você.', author: 'Rumi' },
  { text: 'Só sei que nada sei.', author: 'Sócrates' },
  {
    text: 'Uma vida sem reflexão não vale a pena ser vivida.',
    author: 'Sócrates, na Apologia de Platão',
  },
  { text: 'O início é a parte mais importante do trabalho.', author: 'Platão, A República' },
  {
    text: 'Somos o que repetidamente fazemos. A excelência, portanto, não é um ato, mas um hábito.',
    author: 'Will Durant, sobre Aristóteles',
  },
  { text: 'Ninguém se banha duas vezes no mesmo rio.', author: 'Heráclito' },
  {
    text: 'Não são as coisas que perturbam os homens, mas as opiniões que eles têm sobre as coisas.',
    author: 'Epicteto, Encheirídion 5',
  },
  {
    text: 'A sua mente assume a forma do que você pensa com frequência.',
    author: 'Marco Aurélio, Meditações 5.16',
  },
  {
    text: 'Não é que tenhamos pouco tempo, mas desperdiçamos muito.',
    author: 'Sêneca, Sobre a brevidade da vida',
  },
  { text: 'Enquanto adiamos, a vida passa.', author: 'Sêneca, Cartas a Lucílio 1' },
  {
    text: 'Quem tem um porquê para viver suporta quase qualquer como.',
    author: 'Friedrich Nietzsche',
  },
  {
    text: 'A vida só pode ser compreendida olhando para trás, mas deve ser vivida olhando para frente.',
    author: 'Søren Kierkegaard',
  },
  { text: 'Não rir, não lamentar, nem detestar, mas compreender.', author: 'Baruch Spinoza' },
  {
    text: 'No meio do inverno, aprendi finalmente que havia em mim um verão invencível.',
    author: 'Albert Camus',
  },
  { text: 'Nada de grandioso foi realizado sem entusiasmo.', author: 'Ralph Waldo Emerson' },
  {
    text: 'O correr da vida embrulha tudo; o que ela quer da gente é coragem.',
    author: 'Guimarães Rosa, Grande Sertão: Veredas',
  },
  {
    text: 'Mestre não é quem sempre ensina, mas quem de repente aprende.',
    author: 'Guimarães Rosa, Grande Sertão: Veredas',
  },
  {
    text: 'Feliz aquele que transfere o que sabe e aprende o que ensina.',
    author: 'Cora Coralina',
  },
  {
    text: 'Ninguém educa ninguém, ninguém educa a si mesmo; os homens se educam entre si, mediatizados pelo mundo.',
    author: 'Paulo Freire',
  },
  {
    text: 'Se quer ir rápido, vá sozinho. Se quer ir longe, vá acompanhado.',
    author: 'Provérbio africano',
  },
  { text: 'Eu sou porque nós somos.', author: 'Ubuntu, filosofia africana' },
];

export const QUOTE_STRIDE = 37;
