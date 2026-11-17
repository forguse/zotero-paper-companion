const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const context=vm.createContext({});
vm.runInContext(fs.readFileSync(require.resolve('../addon/content/vocabulary-ui.js'),'utf8'),context);
const UI=context.PCVocabularyUI;
const parts=(sentence,word)=>JSON.parse(JSON.stringify(UI.sentenceParts(sentence,word)));
const hits=(sentence,word)=>parts(sentence,word).filter(part=>part.emphasis).map(part=>part.text);

test('source sentence marks every literal headword case-insensitively without matching longer words',()=>{
  const sentence='Reasoning reasons jointly; REASON and reason remain distinct from reasoning.';
  assert.deepEqual(hits(sentence,'reason'),['REASON','reason']);
  assert.equal(parts(sentence,'reason').map(part=>part.text).join(''),sentence);
});

test('literal phrases can cross PDF whitespace without changing its spaces or line breaks',()=>{
  const sentence='Task\n requirements differ from task   requirements and task requirements-based methods.';
  assert.deepEqual(hits(sentence,'task requirements'),['Task\n requirements','task   requirements','task requirements']);
  assert.equal(parts(sentence,'task requirements').map(part=>part.text).join(''),sentence);
});

test('regular expression punctuation in a headword remains literal',()=>{
  assert.deepEqual(hits('Use a.b and A.B, but never axb or ca.b.','a.b'),['a.b','A.B']);
  assert.deepEqual(hits('C++ and C++17 differ. C++ is literal.','C++'),['C++','C++']);
  assert.deepEqual(hits('An [x] marker and [X] marker.','[x]'),['[x]','[X]']);
});

test('Unicode word boundaries and diacritics avoid embedded substring matches',()=>{
  assert.deepEqual(hits('CAFÉ café cafeteria cafés café2.','café'),['CAFÉ','café']);
  assert.deepEqual(hits('Σχήμα and σχήμα, not προσχήμα.','σχήμα'),['Σχήμα','σχήμα']);
  assert.deepEqual(hits('𝒜test test𝒜 test.','test'),['test']);
});

test('missing terms and nonmatching original forms preserve plain text rather than guessing',()=>{
  assert.deepEqual(parts('It reasons jointly.','reason'),[{text:'It reasons jointly.',emphasis:false}]);
  assert.deepEqual(parts('To be or not to be.',''),[{text:'To be or not to be.',emphasis:false}]);
  assert.deepEqual(parts('', 'be'),[{text:'',emphasis:false}]);
});

test('sentence rendering uses text nodes and marked text even when source contains HTML-like input',()=>{
  const element=(tag)=>({tag,children:[],append(...children){this.children.push(...children);},set textContent(value){this.text=String(value);},get textContent(){return this.text??this.children.map(child=>child.textContent).join('');},set innerHTML(_){throw Error('HTML injection is forbidden');}});
  const ui=Object.create(UI.prototype);ui.doc={createElement:element,createTextNode:text=>({tag:'#text',textContent:text})};
  const sentence='An <img src=x onerror=alert(1)> task and TASK.';
  const rendered=ui.sentenceNode(sentence,'task');
  assert.equal(rendered.tag,'blockquote');assert.equal(rendered.textContent,sentence);
  const marked=rendered.children.filter(child=>child.tag==='mark');
  assert.deepEqual(marked.map(node=>node.textContent),['task','TASK']);
  assert(marked.every(node=>node.className==='vocab-sentence-word'));
  assert(rendered.children.some(node=>node.tag==='#text'&&node.textContent.includes('<img')));
});
