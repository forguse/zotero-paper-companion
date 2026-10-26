const test = require('node:test');
const assert = require('node:assert/strict');
const { PCNoteDocument: Note } = require('../addon/content/note-editor.js');
test('editing a Markdown block preserves every byte outside the selected range, including code and unknown syntax',()=>{
 const text='# Title\r\n\r\nChange this paragraph\r\n\r\n```python\r\nvalue = "**literal**"\r\n\r\n# inside code\r\n```\r\n\r\n$$ x_1 \\to x_2 $$\r\n\r\n::: custom syntax\r\n';
 const blocks=Note.blocks(text), block=blocks.find(b=>b.source.includes('Change this'));
 for(const b of blocks)assert.equal(b.source,text.slice(b.from,b.to));
 const note=new Note(text);note.replace(block.from,block.to,'**Edited**\r\n');
 assert.equal(note.text,text.slice(0,block.from)+'**Edited**\r\n'+text.slice(block.to));
 assert(Note.blocks(text).some(b=>b.source.includes('value =')&&b.source.includes('# inside code')));
 note.undo();assert.equal(note.text,text);note.redo();assert(note.text.includes('**Edited**'));
});
test('insert, delete, clear, undo and redo preserve a document without rebuilding it from rendered HTML',()=>{
 const note=new Note('# Title\n\n> quotation\n');const before=note.text;
 note.replace(note.text.length,note.text.length,'\nnew paragraph');const added=note.text;
 const pos=note.text.indexOf('new paragraph');note.replace(pos,note.text.length,'');assert(!note.text.includes('new paragraph'));
 note.undo();assert.equal(note.text,added);note.set('');assert.equal(note.text,'');note.undo();assert.equal(note.text,added);
 note.undo();note.undo();assert.equal(note.text,before);
 assert.throws(()=>note.replace(-1,0,'bad'),/范围/);assert.equal(note.text,before);
});
test('literal find/replace handles regex characters, Unicode case matching and literal dollar replacements',()=>{
 const note=new Note('A+B a+b 中文 中文');assert.equal(note.find('a+b').length,2);assert.equal(note.find('a+b',true).length,1);
 assert.equal(note.replaceAll('a+b','$& literal'),2);assert.equal(note.text,'$& literal $& literal 中文 中文');
 assert.equal(note.replaceAll('中文','内容'),2);assert.equal(note.find('中文').length,0);note.undo();assert.equal(note.find('中文').length,2);
 assert.equal(note.find('').length,0);
});
test('typing groups coalesce undo while separate edits and per-document histories stay independent',()=>{
 const one=new Note('start'),two=new Note('other');one.set('start a','typing:0');one.set('start ab','typing:0');one.undo();assert.equal(one.text,'start');
 one.redo();assert.equal(one.text,'start ab');one.set('different');one.undo();assert.equal(one.text,'start ab');assert.equal(two.text,'other');assert.equal(two.undoStack.length,0);
});
