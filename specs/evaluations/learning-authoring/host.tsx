import {createRoot} from 'react-dom/client';
import {DagrExplorer} from '@prnt/dagr-explorer';
import type {ExplorerNode, ExplorerEdge} from '@prnt/dagr-explorer';
import '@prnt/dagr-explorer/styles.css';
interface Concept extends ExplorerNode {summary:string;explanation:string;example:string;source:string}
const files=import.meta.glob<{default:{direction:string;nodes:Concept[];edges:ExplorerEdge[]}}>('./*-*.json',{eager:true});
const key=new URLSearchParams(location.search).get('case')??'codebase-baseline';
const data=files[`./${key}.json`].default;
createRoot(document.getElementById('root')!).render(<><h1>{key}</h1><p>{data.direction}</p><div style={{height:600}}><DagrExplorer label={key} nodes={data.nodes} edges={data.edges} layout={{nodeSize:{width:260,height:144}}} searchText={n=>`${n.label} ${n.summary} ${n.explanation}`} renderNode={(n,{tier})=><><strong>{n.label}</strong>{tier==='rich'&&<p>{n.summary}</p>}</>} renderDetails={({node,connections,follow})=><><h3>{node.label}</h3><p>{node.explanation}</p><p>{node.example}</p><p>Source: {node.source}</p><ul>{connections.map(({edge,node:other})=><li key={edge.id}><button onClick={()=>follow(other.id)}>{edge.source===node.id?`${node.label} ${edge.label} ${other.label}`:`${other.label} ${edge.label} ${node.label}`}</button></li>)}</ul></>}/></div><p>End of lesson</p></>);
