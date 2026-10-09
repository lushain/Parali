export default function ProgressRing({small=false}:{small?:boolean}){return <span className={`progress-ring ${small?'small':''}`} aria-hidden="true"><i/><i/><span/></span>;}
