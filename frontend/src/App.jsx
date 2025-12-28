import React, { useState, useRef, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, Link } from 'react-router-dom';
import { Document, Page, pdfjs } from 'react-pdf';
import { Rnd } from 'react-rnd';
import axios from 'axios';
import { get, set, del } from 'idb-keyval'; 
import "./App.css"; 

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const genId = () => crypto.randomUUID ? crypto.randomUUID() : `id_${Math.random().toString(36).substr(2, 9)}`;

const Icons = {
  Trash: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>,
  Copy: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>,
  Reset: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>,
  Upload: () => <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500 mb-4"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  AlignLeft: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="17" y1="10" x2="3" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="17" y1="18" x2="3" y2="18"></line></svg>,
  AlignCenter: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="10" x2="6" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="18" y1="18" x2="6" y2="18"></line></svg>,
  AlignRight: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="21" y1="10" x2="7" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="21" y1="18" x2="7" y2="18"></line></svg>,
  Check: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"></polyline></svg>
};

const FONT_SIZES = [0, ...Array.from({ length: 20 }, (_, i) => i + 6)];

const DraggableField = ({ field, isSelected, isMultiSelect, selectedCount, isDuplicate, onSelect, onUpdate, onDelete, onDuplicateAction, onDragStopRaw }) => {
  const [isNameExpanded, setIsNameExpanded] = useState(false);
  const isRightSide = field.x > 400;
  const isTopSide = field.y < 110;

  return (
    <Rnd
      size={{ width: field.w, height: field.h }}
      position={{ x: field.x, y: field.y }}
      onDragStop={(e, d) => onDragStopRaw(e, d, field.id)}
      onResizeStop={(e, direction, ref, delta, position) => {
        onUpdate(field.id, { w: parseInt(ref.style.width), h: parseInt(ref.style.height), ...position });
      }}
      onClick={(e) => { e.stopPropagation(); onSelect(field.id, e); }}
      className={`group m-0 p-0 ${isSelected ? 'z-50' : 'z-10'}`} 
    >
      {isSelected && !isMultiSelect && (
        <div 
          className="absolute bg-white shadow-xl border border-gray-200 rounded-lg p-3 z-50 flex flex-col gap-2"
          style={{ 
            width: '320px', 
            left: isRightSide ? 'auto' : '0', right: isRightSide ? '0' : 'auto',
            bottom: isTopSide ? 'auto' : '100%', top: isTopSide ? '100%' : 'auto',
            marginTop: isTopSide ? '10px' : '0', marginBottom: isTopSide ? '0' : '10px',
          }}
          onMouseDown={(e) => e.stopPropagation()} 
        >
          <div className="flex flex-col gap-2 border-b border-gray-100 pb-2">
            <div className="flex justify-between items-center">
                 <label className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Field Name</label>
                 <select 
                    value={field.subtype === 'dropdown' ? 'yesno' : field.type}
                    onChange={(e) => {
                        const val = e.target.value;
                        if (val === 'yesno') onUpdate(field.id, { type: 'text', subtype: 'dropdown', options: ['Yes', 'No'] });
                        else if (val === 'checkbox') onUpdate(field.id, { type: 'checkbox', subtype: null });
                        else onUpdate(field.id, { type: 'text', subtype: null });
                    }}
                    className="text-[10px] border border-blue-200 text-blue-600 rounded px-1 bg-blue-50 font-bold uppercase cursor-pointer outline-none"
                 >
                    <option value="text">Text Box</option>
                    <option value="yesno">Yes/No Dropdown</option>
                    <option value="checkbox">Checkbox</option>
                 </select>
            </div>

            {!isNameExpanded && (
               <div 
                 className={`text-xs font-semibold text-gray-700 bg-gray-50 border rounded px-2 py-1 h-8 w-full cursor-text hover:bg-white transition-colors flex items-center ${isDuplicate ? 'border-red-500 bg-red-50' : 'border-gray-300 hover:border-blue-400'}`}
                 onClick={() => setIsNameExpanded(true)}
                 title={field.name} 
               >
                 <span className="truncate w-full block">{field.name}</span>
               </div>
            )}
            {isNameExpanded && (
               <div className="absolute top-8 left-0 w-full z-50 bg-white border border-blue-400 shadow-2xl rounded-md p-2 flex flex-col gap-2">
                  <textarea autoFocus value={field.name} onChange={(e) => onUpdate(field.id, { name: e.target.value })} className="text-xs font-semibold text-gray-700 outline-none bg-gray-50 border border-gray-200 rounded px-2 py-2 resize-none h-24 w-full" />
                  <button onClick={() => setIsNameExpanded(false)} className="self-end flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white text-[10px] font-bold px-3 py-1 rounded shadow-sm transition-colors"><Icons.Check /> DONE</button>
               </div>
            )}
          </div>
          
          {field.type !== 'checkbox' && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                  {/* FONT SIZE SELECTOR - RESTORED */}
                  <select 
                    value={field.fontSize} 
                    onChange={(e) => onUpdate(field.id, { fontSize: parseInt(e.target.value) })}
                    className="text-xs border border-gray-300 rounded p-1 bg-white focus:border-blue-500 outline-none"
                  >
                    {FONT_SIZES.map(size => <option key={size} value={size}>{size === 0 ? "Auto" : `${size}px`}</option>)}
                  </select>
                  
                  {field.subtype !== 'dropdown' && (
                      <label className="flex items-center gap-1 text-[10px] text-gray-500 cursor-pointer select-none">
                          <input type="checkbox" checked={field.isMultiline !== false} onChange={(e) => onUpdate(field.id, { isMultiline: e.target.checked })} className="accent-blue-600" /> Multiline
                      </label>
                  )}
              </div>
              <div className="flex items-center gap-2">
                  {field.subtype !== 'dropdown' && (
                       <div className="flex bg-gray-100 rounded p-0.5 border border-gray-200">
                          {['left', 'center', 'right'].map(align => (
                            <button key={align} onClick={() => onUpdate(field.id, { align })} className={`p-1.5 rounded transition-all ${field.align === align ? 'bg-white shadow-sm text-blue-600' : 'text-gray-400 hover:text-gray-700'}`}>
                               {align === 'left' && <Icons.AlignLeft />} {align === 'center' && <Icons.AlignCenter />} {align === 'right' && <Icons.AlignRight />}
                            </button>
                          ))}
                       </div>
                  )}
                  <div className="h-4 w-px bg-gray-300"></div>
                  <button onClick={() => onDuplicateAction(field.id)} className="p-1.5 hover:bg-gray-100 rounded text-gray-600 transition-colors" title="Duplicate"><Icons.Copy /></button>
                  <button onClick={() => onDelete(field.id)} className="p-1.5 hover:bg-red-50 rounded text-red-500 transition-colors" title="Delete"><Icons.Trash /></button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className={`w-full h-full flex items-center px-1 cursor-move overflow-hidden transition-all duration-150 border-2 ${isSelected ? 'border-blue-500 bg-blue-100/50 shadow-md' : (isDuplicate ? 'border-red-500 bg-red-50/50' : 'border-blue-300 border-solid bg-blue-50/30 hover:bg-blue-50/50')} ${field.type === 'checkbox' ? 'justify-center' : ''}`}>
        {field.subtype === 'dropdown' ? (
             <div className="w-full h-full flex items-center justify-between px-2 bg-white border border-gray-300 rounded text-[10px] text-gray-600 font-mono select-none pointer-events-none"><span>Select...</span><span>▼</span></div>
        ) : field.type === 'checkbox' ? (
             <div className="w-5 h-5 border-2 border-blue-600 bg-white rounded flex items-center justify-center pointer-events-none">{isSelected && <div className="w-3 h-3 bg-blue-600 rounded-sm"></div>}</div>
        ) : (
            <span className="w-full text-blue-900 opacity-90 whitespace-pre-wrap overflow-hidden block pointer-events-none" style={{ fontSize: field.fontSize === 0 ? '12px' : `${field.fontSize}px`, textAlign: field.align, lineHeight: '1.2' }}>{field.name}</span>
        )}
      </div>
    </Rnd>
  );
};

function App() { return <BrowserRouter><FormForgeApp /></BrowserRouter>; }

function FormForgeApp() {
  const [fileUrl, setFileUrl] = useState(null);
  const [serverFilename, setServerFilename] = useState(null);
  const [numPages, setNumPages] = useState(null);
  const [fields, setFields] = useState([]);
  const [selectedFieldIds, setSelectedFieldIds] = useState([]); 
  const [addingMode, setAddingMode] = useState(null); 
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const pageRefs = useRef({});
  const fileInputRef = useRef(null); 
  const navigate = useNavigate();

  const nameCounts = fields.reduce((acc, field) => { acc[field.name] = (acc[field.name] || 0) + 1; return acc; }, {});

  useEffect(() => {
    const loadState = async () => {
      const savedFilename = localStorage.getItem('server_filename');
      const savedFields = localStorage.getItem('pdf_fields');
      if (savedFilename) {
        setServerFilename(savedFilename);
        setFileUrl(`http://localhost:5000/files/${savedFilename}`);
        if (savedFields) setFields(JSON.parse(savedFields));
        navigate('/editor');
      }
      setIsLoading(false);
    };
    loadState();
  }, []);

  useEffect(() => {
    if (fields.length > 0) localStorage.setItem('pdf_fields', JSON.stringify(fields));
    if (serverFilename) localStorage.setItem('server_filename', serverFilename);
  }, [fields, serverFilename]);

  const handleFileUpload = async (e) => {
    const selectedFile = e.target.files ? e.target.files[0] : e.dataTransfer.files[0];
    if (!selectedFile) return;
    setIsProcessing(true);
    const formData = new FormData();
    formData.append('pdf', selectedFile);
    try {
      const res = await axios.post('http://localhost:5000/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setServerFilename(res.data.filename);
      setFileUrl(`http://localhost:5000/files/${res.data.filename}`);
      const importedFields = (res.data.fields || []).map(f => ({ ...f, align: f.align || 'center', fontSize: f.fontSize !== undefined ? f.fontSize : 0, isMultiline: f.isMultiline !== undefined ? f.isMultiline : true }));
      setFields(importedFields); 
      localStorage.removeItem('pdf_fields');
      navigate('/editor');
    } catch (error) { console.error("Upload failed", error); alert("Error uploading file."); } finally { setIsProcessing(false); }
  };

  const handleReset = () => { if(window.confirm("Clear all?")) { localStorage.removeItem('pdf_fields'); localStorage.removeItem('server_filename'); setFileUrl(null); setFields([]); navigate('/'); } };
  const onDocumentLoadSuccess = ({ numPages }) => setNumPages(numPages);

  const handleCanvasClick = (e, pageIndex) => {
    if (addingMode) {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const id = genId();
        const w = addingMode === 'text' ? 160 : 30;
        const h = 30;
        setFields([...fields, { id, type: addingMode, page: pageIndex, x: x - (w/2), y: y - (h/2), w, h, name: `field_${id.slice(0, 5)}`, required: false, fontSize: 0, align: 'center', isMultiline: true }]);
        setAddingMode(null);
        setSelectedFieldIds([id]);
        return;
    }
    setSelectedFieldIds([]);
  };

  const handleFieldSelect = (id, e) => {
    if (e.ctrlKey || e.metaKey) setSelectedFieldIds(prev => prev.includes(id) ? prev.filter(fid => fid !== id) : [...prev, id]);
    else setSelectedFieldIds([id]);
  };

  const updateField = (id, newProps) => setFields(prev => prev.map(f => f.id === id ? { ...f, ...newProps } : f));
  
  const deleteSelected = () => { if(window.confirm(`Delete ${selectedFieldIds.length} items?`)) { setFields(prev => prev.filter(f => !selectedFieldIds.includes(f.id))); setSelectedFieldIds([]); } };
  const deleteField = (id) => { setFields(prev => prev.filter(f => f.id !== id)); setSelectedFieldIds(prev => prev.filter(fid => fid !== id)); };
  const duplicateField = (id) => { const field = fields.find(f => f.id === id); if (!field) return; const newId = genId(); setFields([...fields, { ...field, id: newId, x: field.x + 20, y: field.y + 20, name: `${field.name}_copy`, align: field.align || 'center' }]); setSelectedFieldIds([newId]); };
  const handleDragStop = (e, d, fieldId) => { const boxRect = d.node.getBoundingClientRect(); const boxCenterY = boxRect.top + (boxRect.height / 2); for (let i = 0; i < numPages; i++) { const pageEl = pageRefs.current[i]; if (pageEl) { const pageRect = pageEl.getBoundingClientRect(); if (boxCenterY >= pageRect.top && boxCenterY <= pageRect.bottom) { updateField(fieldId, { page: i, x: boxRect.left - pageRect.left, y: boxRect.top - pageRect.top }); break; } } } };

  const handleSave = async () => {
    if (!serverFilename) return;
    setIsSaving(true);
    try {
      const res = await axios.post('http://localhost:5000/process-pdf', { filename: serverFilename, fields }, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'edited_form.pdf');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) { console.error("Save failed:", err); alert("Failed to save PDF."); } finally { setIsSaving(false); }
  };

  if (isLoading) return <div className="flex h-screen items-center justify-center text-blue-600">Restoring...</div>;
  if (isProcessing) return <div className="flex h-screen items-center justify-center text-blue-600 text-xl font-bold animate-pulse">Analyzing PDF Structure...</div>;

  return (
    <div className={`bg-slate-50 min-h-screen font-sans ${addingMode ? 'cursor-crosshair' : ''}`}>
      <style>{`.react-pdf__Page { margin: 0 !important; } .react-pdf__Page__canvas { display: block !important; }`}</style>
      
      <nav className="fixed top-0 left-0 w-full h-16 bg-white border-b border-gray-200 shadow-sm z-50 flex items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">A</div>
            <span className="text-xl font-bold text-gray-800 tracking-tight">AutoFormForge</span>
        </Link>
        {fileUrl && (
          <div className="flex items-center gap-3">
             <button onClick={() => setAddingMode(addingMode === 'text' ? null : 'text')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${addingMode === 'text' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 text-gray-700'}`}><span className="text-lg font-serif">T</span> Text</button>
             <button onClick={() => setAddingMode(addingMode === 'checkbox' ? null : 'checkbox')} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${addingMode === 'checkbox' ? 'bg-green-600 text-white shadow-md' : 'bg-gray-100 text-gray-700'}`}><span>☑</span> Checkbox</button>
             <div className="h-6 w-px bg-gray-300 mx-2"></div>
             <button onClick={handleReset} className="p-2 text-gray-400 hover:text-red-500"><Icons.Reset /></button>
             <button onClick={handleSave} disabled={isSaving} className={`bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-2 rounded-lg text-sm font-bold shadow-lg transition-all ${isSaving ? 'opacity-75 cursor-wait' : 'hover:from-blue-700'}`}>{isSaving ? "Processing..." : "Download"}</button>
          </div>
        )}
      </nav>

      {selectedFieldIds.length > 1 && (
        <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 bg-white shadow-2xl border border-gray-200 rounded-full px-6 py-3 flex items-center gap-4 z-[100] animate-in fade-in slide-in-from-bottom-4">
            <div className="bg-blue-100 text-blue-700 font-bold px-3 py-1 rounded-full text-xs">{selectedFieldIds.length} Selected</div>
            <div className="h-4 w-px bg-gray-300"></div>
            <button onClick={deleteSelected} className="flex items-center gap-2 text-red-600 hover:text-red-700 font-bold text-sm transition-colors"><Icons.Trash /> Delete All</button>
            <button onClick={() => setSelectedFieldIds([])} className="text-gray-400 hover:text-gray-600 text-xl font-light ml-2 leading-none">&times;</button>
        </div>
      )}

      <div className="pt-20 pb-10 min-h-screen flex flex-col items-center select-none">
        <Routes>
          <Route path="/" element={
            <div className="flex-grow flex flex-col items-center justify-center w-full px-4 gap-6">
                {fileUrl && (
                  <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 w-full max-w-xl flex items-center justify-between shadow-sm">
                    <div><h3 className="font-bold text-gray-800">Session Found</h3><p className="text-sm text-gray-500">Resume editing previous file?</p></div>
                    <Link to="/editor" className="bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold">Resume</Link>
                  </div>
                )}
                <div className="bg-white rounded-3xl shadow-2xl p-12 max-w-xl w-full text-center border border-gray-100 transition-all hover:shadow-3xl">
                    <div className="border-2 border-dashed border-blue-200 rounded-2xl p-10 flex flex-col items-center justify-center bg-blue-50/30 hover:bg-blue-50 transition-colors" onDragOver={(e) => e.preventDefault()} onDrop={handleFileUpload}>
                        <Icons.Upload />
                        <h2 className="text-2xl font-bold text-gray-800 mb-2">Upload PDF</h2>
                        <p className="text-gray-400 mb-6">Drag & Drop or Click to Upload</p>
                        <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="application/pdf" hidden />
                        <button onClick={() => fileInputRef.current.click()} className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-full font-semibold shadow-lg">Select File</button>
                    </div>
                </div>
            </div>
          } />

          <Route path="/editor" element={
            fileUrl ? (
              <div className="w-full flex justify-center p-4">
                <Document file={fileUrl} onLoadSuccess={onDocumentLoadSuccess} className="flex flex-col gap-8">
                    {Array.from(new Array(numPages), (_, i) => (
                      <div key={i} className="relative bg-white shadow-xl transition-shadow group" style={{ width: '800px' }} ref={el => pageRefs.current[i] = el} onClick={(e) => handleCanvasClick(e, i)}>
                        <Page pageNumber={i + 1} renderTextLayer={false} renderAnnotationLayer={false} width={800} />
                        {fields.filter(f => f.page === i).map(field => (
                          <DraggableField 
                            key={field.id} field={field} 
                            isSelected={selectedFieldIds.includes(field.id)} 
                            isMultiSelect={selectedFieldIds.length > 1} 
                            selectedCount={selectedFieldIds.length} 
                            isDuplicate={nameCounts[field.name] > 1} 
                            onSelect={handleFieldSelect} onUpdate={updateField} onDelete={deleteField} onDuplicateAction={duplicateField} onDragStopRaw={handleDragStop} 
                          />
                        ))}
                      </div>
                    ))}
                </Document>
              </div>
            ) : <div className="text-gray-500">Redirecting...</div>
          } />
        </Routes>
      </div>
    </div>
  );
}

export default App;