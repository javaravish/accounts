"use strict";

/* =========================================================
   PDF GENERATION
   Monthly DCB, Cumulative DCB, Loan Ledger, print-window layout,
   table fitting, fonts, page layout and combined PDF orchestration.
   ========================================================= */
function pdfParentLabel(){return modeConfig().parent;}
    function pdfChildLabel(){return modeConfig().child;}

    /*
     * PDF location rules are intentionally tied ONLY to the active login
     * system.  MS Login and VO Login must never share the same location
     * ordering/fields.
     *
     * MS Login PDFs:  MS -> Mandal -> District
     * VO Login PDFs:  VO -> Village -> Mandal
     */
    function isMsLoginPdf(){return currentMode==="MS";}
    function pdfLocationLabelTelugu(){return isMsLoginPdf()?"జిల్లా":"గ్రామం";}
    function pdfLocationValue(v){return isMsLoginPdf()?(v.district||""):(v.village||"");}
    function pdfHeaderLocationText(v){
      if(isMsLoginPdf()){
        return `${pdfParentLabel()} : ${esc(v.name||"")},&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;మండలం : ${esc(v.mandal||"")},&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;జిల్లా : ${esc(v.district||"")}`;
      }
      return `${pdfParentLabel()} : ${esc(v.name||"")},&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${pdfLocationLabelTelugu()} : ${esc(pdfLocationValue(v))},&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;మండలం : ${esc(v.mandal||"")}`;
    }

    /*
     * UNIVERSAL PDF TABLE FITTING ENGINE
     * ----------------------------------
     * One fitting algorithm is used by EVERY PDF table in this file.
     *
     * Rules:
     * 1. Start every column at equal width.
     * 2. Measure the real rendered text using the loaded PDF font.
     * 3. Give long columns more width and take spare width from columns that
     *    genuinely have room to give.
     * 4. Never wrap, truncate, clip, hide or omit data.
     * 5. Never assign a different font size to individual cells.
     * DCB / Cumulative DCB exact fallback:
     * 1. 10 mm left/right + all data 13pt.
     * 2. If insufficient, 8 mm left/right + all data 13pt.
     * 3. If still insufficient, Child Name only becomes 10pt.
     * 4. If still insufficient, only the SHG Name row/cell that needs it wraps.
     * S.No is fixed and never donates space. All other columns donate spare
     * available width before any fallback stage.
     *
     * DCB / Cumulative DCB row rules:
     * - Maximum 25 REAL data rows per page.
     * - No filler rows are inserted.
     * - Total is not counted as a data row.
     * - The actual number of rows on a page determines the data-row height so
     *   the table uses the available page height efficiently.
     */
    const FIXED_SN_WIDTH=24.000; // fixed compact S.N column for every PDF

    function fitAllPDFTablesInPrintWindow(w){
      try{
        const doc=w.document;
        const A4_WIDTH=841.89;
        const A4_HEIGHT=595.28;
        const PAGE_MARGIN=28.3465;
        const PAGE_AVAILABLE=A4_WIDTH-(PAGE_MARGIN*2); // fixed 10 mm safe area on all sides

        const COMMON_REDUCTION_START=13;
        const COMMON_MIN_FONT=13;
        const COMMON_FONT_STEP=.25;
        const EPS=.05;

        function cssNumber(value){
          const n=parseFloat(value);
          return Number.isFinite(n)?n:0;
        }

        function ptFromPx(px){
          return px*72/96;
        }

        function pxFromPt(pt){
          return pt*96/72;
        }

        function clean(value){
          return String(value==null?"":value)
            .replace(/\u00a0/g," ")
            .replace(/\s+/g," ")
            .trim();
        }

        function paddingPt(el){
          const cs=w.getComputedStyle(el);
          return cssNumber(cs.paddingLeft)+cssNumber(cs.paddingRight);
        }

        function borderPt(el){
          const cs=w.getComputedStyle(el);
          return cssNumber(cs.borderLeftWidth)+cssNumber(cs.borderRightWidth);
        }

        function cellFontSizePt(el){
          const n=cssNumber(w.getComputedStyle(el).fontSize);
          return n>0?n:13;
        }

        /* Real DOM ruler: same browser/font metrics as the print document. */
        const ruler=doc.createElement("span");
        ruler.style.position="absolute";
        ruler.style.left="-100000px";
        ruler.style.top="-100000px";
        ruler.style.visibility="hidden";
        ruler.style.display="block";
        ruler.style.whiteSpace="nowrap";
        ruler.style.width="max-content";
        ruler.style.height="auto";
        ruler.style.padding="0";
        ruler.style.margin="0";
        ruler.style.border="0";
        ruler.style.lineHeight="1";
        ruler.style.boxSizing="content-box";
        doc.body.appendChild(ruler);

        function measureTextPt(reference,value,sizePt){
          const text=String(value==null?"":value);
          if(!text)return 0;

          const cs=w.getComputedStyle(reference);
          ruler.style.fontFamily=cs.fontFamily;
          ruler.style.fontWeight=cs.fontWeight;
          ruler.style.fontStyle=cs.fontStyle;
          ruler.style.fontStretch=cs.fontStretch;
          ruler.style.fontVariant=cs.fontVariant;
          ruler.style.letterSpacing=cs.letterSpacing;
          ruler.style.textTransform=cs.textTransform;
          ruler.style.fontSize=sizePt+"pt";
          ruler.textContent=text;

          return ptFromPx(ruler.getBoundingClientRect().width);
        }

        function dataRows(table){
          return Array.from(table.querySelectorAll("tbody tr.data-row"));
        }

        function dataCells(table){
          const cells=dataRows(table).flatMap(tr=>
            Array.from(tr.children).filter(cell=>cell.tagName==="TD")
          );
          /* The final Total row is part of the same width/fit rules as data.
           * It is NOT a normal data row for pagination, but every Total cell
           * must participate in column sizing and final wrapping. */
          const total=table.querySelector("tbody tr.total");
          if(total){
            cells.push(...Array.from(total.children).filter(cell=>cell.tagName==="TD"));
          }
          return cells;
        }

        function columnCount(table){
          return table.querySelectorAll("colgroup col").length;
        }

        function resetTableTransform(table){
          table.style.removeProperty("transform");
          table.style.removeProperty("transform-origin");
          table.style.removeProperty("margin-left");
          table.style.removeProperty("margin-right");
          table.style.removeProperty("overflow");
        }

        function setCommonDataFont(table,size){
          table.querySelectorAll(
            "tbody tr.data-row td, tbody tr.data-row td .pdf-cell-text, "+
            "tbody tr.total td, tbody tr.total td .pdf-cell-text"
          ).forEach(el=>{
            el.style.setProperty("font-family",'"Gidugu", Arial, sans-serif',"important");
            el.style.setProperty("font-size",size+"pt","important");
            el.style.setProperty("font-weight","400","important");
            el.style.setProperty("font-style","normal","important");
            el.style.setProperty("font-synthesis","none","important");
            el.style.setProperty("white-space","nowrap","important");
            el.style.setProperty("overflow","visible","important");
            el.style.setProperty("text-overflow","clip","important");
            el.style.setProperty("line-height","1","important");
          });
        }

        function setWidths(table,widths){
          const cols=Array.from(table.querySelectorAll("colgroup col"));
          if(cols.length!==widths.length)return;

          cols.forEach((col,i)=>{
            col.style.width=Math.max(.1,widths[i]).toFixed(4)+"pt";
          });

          table.style.width=widths.reduce((a,b)=>a+b,0).toFixed(4)+"pt";
          table.style.maxWidth="none";
          table.style.tableLayout="fixed";
        }

        function availableWidthForTable(table){
          /* Prefer the actual print page width. This intentionally consumes the
             small page margins efficiently, as requested. */
          const page=table.closest(".page")||table.parentElement;
          if(page){
            const cs=w.getComputedStyle(page);
            const pageWidth=cssNumber(cs.width);
            if(pageWidth>0)return Math.min(PAGE_AVAILABLE,pageWidth-(PAGE_MARGIN*2));
          }
          return PAGE_AVAILABLE;
        }

        function headerMinimums(table,count,size){
          const mins=Array(count).fill(0);

          table.querySelectorAll("thead tr").forEach(tr=>{
            let col=0;

            Array.from(tr.children).forEach(cell=>{
              const span=cell.colSpan||1;

              if(span===1 && col<count){
                const raw=(cell.innerText||cell.textContent||"")
                  .replace(/\r/g,"");

                const lines=raw.split("\n")
                  .map(clean)
                  .filter(Boolean);

                const longest=lines.reduce(
                  (a,b)=>b.length>a.length?b:a,
                  ""
                );

                if(longest){
                  const headerSize=cellFontSizePt(cell);
                  mins[col]=Math.max(
                    mins[col],
                    measureTextPt(cell,longest,headerSize)+
                    paddingPt(cell)+borderPt(cell)+2
                  );
                }
              }

              col+=span;
            });
          });

          return mins;
        }

        function requiredByColumn(table,size){
          const count=columnCount(table);
          const required=Array(count).fill(0);

          /*
           * IMPORTANT:
           * Column width is driven by REAL DATA first.
           *
           * Header text is intentionally NOT treated as a hard minimum.
           * DCB headers are allowed to wrap, so header space can be surrendered
           * when a data column (especially SHG Name) needs more room.
           *
           * Column 1 (S.No) is handled separately by redistribute() and remains
           * fixed at FIXED_SN_WIDTH.
           */
          dataCells(table).forEach(td=>{
            const col=td.cellIndex;
            if(col<0 || col>=count || col===0)return;

            const text=(td.textContent||"").trim();
            required[col]=Math.max(
              required[col],
              measureTextPt(td,text,size)+
              paddingPt(td)+borderPt(td)+2
            );
          });

          /*
           * Do not add headerMinimums() here.
           * Headers can wrap and therefore are a SOFT requirement.
           * This lets unused width in header-heavy columns be transferred
           * to columns whose actual data needs more room.
           */
          return required;
        }

        /*
         * SMART SPACE REDISTRIBUTION
         * -------------------------
         * 1. S.No (column 1) is permanently fixed and never donates space.
         * 2. Every other column starts from an equal share of the usable width.
         * 3. A column needing more than its equal share gets a DEFICIT.
         * 4. EVERY other column with width above its REAL DATA requirement is a
         *    donor. Donors give up their surplus proportionally.
         * 5. Header width is NOT a protected floor because DCB headers may wrap.
         * 6. If total real-data requirements fit inside the page, all data gets
         *    its required width and any remaining space is distributed normally.
         * 7. If total real-data requirements exceed the page, every donor is
         *    reduced as far as its own data requirement allows; the remaining
         *    unavoidable shortage is shared among the needy columns.
         *
         * This means a long SHG name can take space from columns 3,4,5,...17
         * wherever those columns have genuine spare data capacity. It is not
         * limited to a pre-selected donor column.
         */
        function redistribute(required,available){
          const count=required.length;
          if(!count)return [];

          const slNoIndex=0;
          const slNoWidth=Math.min(FIXED_SN_WIDTH,Math.max(.1,available));

          if(count===1)return [slNoWidth];

          const remaining=Math.max(.1,available-slNoWidth);
          const n=count-1;
          const equal=remaining/n;

          let widths=Array(count).fill(equal);
          widths[slNoIndex]=slNoWidth;

          const req=required.slice(1).map(r=>Math.max(.1,r));

          /*
           * First pass: start from equal columns and calculate who needs
           * additional space and who can donate it.
           */
          let need=req.map((r,i)=>Math.max(0,r-equal));
          let spare=Array(n).fill(0).map((_,i)=>Math.max(0,equal-req[i]));

          let totalNeed=need.reduce((a,b)=>a+b,0);
          let totalSpare=spare.reduce((a,b)=>a+b,0);

          if(totalNeed>EPS && totalSpare>EPS){
            const transfer=Math.min(totalNeed,totalSpare);

            /*
             * Take space from ALL donor columns, proportional to each donor's
             * available surplus, and give it to ALL needy columns, proportional
             * to each needy column's deficit.
             */
            for(let i=0;i<n;i++){
              if(totalNeed>EPS && need[i]>0)
                widths[i+1]+=transfer*(need[i]/totalNeed);
            }

            for(let i=0;i<n;i++){
              if(totalSpare>EPS && spare[i]>0)
                widths[i+1]-=transfer*(spare[i]/totalSpare);
            }
          }

          /*
           * If the first transfer was not enough, force every donor down to
           * its REAL DATA requirement. Headers are allowed to wrap and therefore
           * do not block this transfer.
           */
          let used=widths.reduce((a,b)=>a+b,0);
          let shortage=0;

          for(let i=0;i<n;i++){
            if(widths[i+1] < req[i]-EPS){
              shortage += req[i]-widths[i+1];
            }
          }

          if(shortage>EPS){
            let donorSpace=0;
            for(let i=0;i<n;i++){
              donorSpace += Math.max(0,widths[i+1]-req[i]);
            }

            if(donorSpace>EPS){
              for(let i=0;i<n;i++){
                const donor=Math.max(0,widths[i+1]-req[i]);
                if(donor>0)
                  widths[i+1]-=Math.min(donor,donorSpace*shortage/donorSpace);
              }
            }

            /*
             * Rebuild the final allocation from data requirements if possible.
             * This guarantees the complete table still occupies exactly the
             * A4 safe width while never taking anything from S.No.
             */
            const reqSum=req.reduce((a,b)=>a+b,0);

            if(reqSum<=remaining+EPS){
              for(let i=0;i<n;i++) widths[i+1]=req[i];

              let leftover=remaining-reqSum;

              /*
               * Give leftover back to the non-S.No columns. Columns with
               * longer data receive a little more room, while all columns
               * remain within the same total page width.
               */
              const weights=req.map(r=>Math.max(1,r));
              const weightSum=weights.reduce((a,b)=>a+b,0);

              for(let i=0;i<n;i++){
                widths[i+1]+=leftover*(weights[i]/weightSum);
              }
            }else{
              /*
               * Genuine page-width shortage: keep 13pt data and use the entire
               * available width. The unavoidable deficit is shared among all
               * columns according to their required width. S.No remains fixed.
               */
              const scale=remaining/reqSum;
              for(let i=0;i<n;i++){
                widths[i+1]=Math.max(.1,req[i]*scale);
              }
            }
          }

          /*
           * Final normalization applies ONLY to columns 2 onward.
           * Column 1 remains exactly FIXED_SN_WIDTH.
           */
          const otherSum=widths.slice(1).reduce((a,b)=>a+b,0);
          if(otherSum>0){
            const scale=remaining/otherSum;
            for(let i=1;i<count;i++) widths[i]*=scale;
          }

          widths[slNoIndex]=slNoWidth;
          return widths;
        }

        function allDataCellsFit(table,widths,size){
          let fits=true;

          dataCells(table).forEach(td=>{
            const col=td.cellIndex;
            if(col<0 || col>=widths.length)return;

            const available=Math.max(
              0,
              widths[col]-paddingPt(td)-borderPt(td)-2
            );

            if(measureTextPt(td,td.textContent||"",size)>available+EPS){
              fits=false;
            }
          });

          return fits;
        }

        function setDcbRowHeight(table){
          const page=table.closest(".dcb-page,.cumulative-dcb-page");
          if(!page)return;

          const rows=dataRows(table);
          if(!rows.length)return;

          const total=table.querySelector("tbody tr.total");
          const pageHeight=A4_HEIGHT;
          const pageCS=w.getComputedStyle(page);
          const pagePaddingTop=cssNumber(pageCS.paddingTop);
          const pagePaddingBottom=cssNumber(pageCS.paddingBottom);

          const blank=page.querySelector(".dcb-top-blank");
          const head=page.querySelector(".dcb-head,.cumulative-dcb-head");

          const blankH=blank ? blank.getBoundingClientRect().height*72/96 : 0;
          const headH=head ? head.getBoundingClientRect().height*72/96 : 0;
          const thead=table.tHead;
          const theadH=thead ? thead.getBoundingClientRect().height*72/96 : 0;
          const totalH=total ? total.getBoundingClientRect().height*72/96 : 0;

          const safety=2;
          const usable=Math.max(
            1,
            pageHeight-
            pagePaddingTop-
            pagePaddingBottom-
            blankH-
            headH-
            theadH-
            totalH-
            safety
          );

          const FIXED_DCB_ROW_HEIGHT=20;

          /*
           * Normal rows remain 20pt. A row containing a wrapped SHG Name gets
           * the height actually required by that cell, so wrapping is a real
           * last-resort option rather than clipped text.
           */
          const requested=rows.map(row=>{
            let h=FIXED_DCB_ROW_HEIGHT;

            if(row.dataset.shgWrapped==="true" || row.dataset.finalWrapped==="true"){
              Array.from(row.children).forEach(td=>{
                if(td.dataset.wrapShg!=="true" && td.dataset.wrapFinal!=="true")return;

                const measured=td.getBoundingClientRect().height*72/96;
                h=Math.max(h,measured+2);
              });
            }

            return Math.max(12,h);
          });

          const requestedSum=requested.reduce((a,b)=>a+b,0);

          /*
           * If wrapped rows make 25 rows too tall, compress the row heights
           * proportionally, but never below 12pt. The SHG text remains wrapped
           * and at 10pt; it is never hidden.
           */
          let scale=1;
          if(requestedSum>usable){
            scale=Math.max(
              12/FIXED_DCB_ROW_HEIGHT,
              usable/requestedSum
            );
          }

          rows.forEach((row,i)=>{
            const h=Math.max(12,requested[i]*scale);

            row.style.height=h.toFixed(3)+"pt";
            row.style.minHeight=h.toFixed(3)+"pt";
            row.style.maxHeight=h.toFixed(3)+"pt";
            row.style.breakInside="avoid";
            row.style.pageBreakInside="avoid";

            Array.from(row.children).forEach(td=>{
              td.style.height=h.toFixed(3)+"pt";
              td.style.minHeight=h.toFixed(3)+"pt";
              td.style.maxHeight=h.toFixed(3)+"pt";
            });
          });
        }

        function fitOneTable(table){
          const count=columnCount(table);
          if(!count)return;

          const isDcb=table.matches(".dcb-table,.cumulative-dcb-table");
          const isLedger=table.matches(".ledger-table");
          const page=table.closest(".dcb-page,.cumulative-dcb-page,.ledger-page");

          const M10=28.3465; // 10 mm
          const M8=22.6772;  // 8 mm
          const W10=A4_WIDTH-(M10*2);
          const W8=A4_WIDTH-(M8*2);
          const SHG_COL=1;   // S.No=0, SHG Name=1

          /*
           * EXACT FALLBACK ORDER
           * --------------------
           * DCB + Cumulative DCB:
           *   1) 10 mm left/right + every DATA cell 13pt
           *   2) only if stage 1 cannot fit -> 8 mm left/right + every DATA cell 13pt
           *   3) only if stage 2 cannot fit -> SHG NAME ONLY becomes 10pt
           *   4) only if stage 3 cannot fit -> wrap ONLY the SHG NAME cell(s)
           *      whose own text still does not fit.
           *
           * S.No is permanently fixed and never donates space.
           * All columns except S.No may donate their spare width before any
           * fallback stage is triggered.
           *
           * Loan Ledger has no SHG-name DATA column. It therefore uses stages
           * 1 and 2 only, while all Ledger data remains 13pt.
           */

          function setStage(marginPt,widthPt){
            if(page){
              page.style.setProperty(
                "padding-left",`${marginPt.toFixed(4)}pt`,"important"
              );
              page.style.setProperty(
                "padding-right",`${marginPt.toFixed(4)}pt`,"important"
              );
            }

            const frame=page ? page.querySelector(
              isLedger ? ".ledger-frame" :
              (table.classList.contains("cumulative-dcb-table")
                ? ".cumulative-dcb-frame"
                : ".dcb-frame")
            ) : null;

            if(frame){
              frame.style.setProperty("width",`${widthPt.toFixed(4)}pt`,"important");
              frame.style.setProperty("max-width",`${widthPt.toFixed(4)}pt`,"important");
              frame.style.setProperty("min-width",`${widthPt.toFixed(4)}pt`,"important");
              frame.style.marginLeft="0";
              frame.style.marginRight="0";
              frame.style.boxSizing="border-box";
            }

            /* LOAN LEDGER ONLY:
             * The browser's collapsed-border rendering needs a small
             * sub-point correction so the final table edge lands exactly on
             * the .ledger-frame right border.
             *
             * 10 mm stage: 785.197pt frame -> 784.500pt Ledger table.
             * DCB and Cumulative DCB are completely unchanged.
             */
            const tableWidthPt = isLedger
              ? Math.max(0.1, widthPt - 0.697)
              : widthPt;
            table.style.setProperty("width",`${tableWidthPt.toFixed(4)}pt`,"important");
            table.style.setProperty("max-width",`${tableWidthPt.toFixed(4)}pt`,"important");
            table.style.setProperty("min-width",`${tableWidthPt.toFixed(4)}pt`,"important");
            table.style.marginLeft="0";
            table.style.marginRight="0";
            table.style.boxSizing="border-box";
            table.dataset.pdfWidthPt=String(widthPt);
            table.dataset.pdfMarginPt=String(marginPt);
          }

          function clearDcbFallbackStyles(){
            if(!isDcb)return;

            table.querySelectorAll("tbody td").forEach(td=>{
              td.dataset.wrapShg="false";
              td.dataset.wrapFinal="false";
              td.dataset.shgFont10="false";
              td.style.removeProperty("font-size");
              td.style.removeProperty("font-family");
              td.style.removeProperty("font-weight");
              td.style.removeProperty("font-style");
              td.style.removeProperty("font-synthesis");
              td.style.removeProperty("line-height");
              td.style.removeProperty("white-space");
              td.style.removeProperty("overflow");
              td.style.removeProperty("overflow-wrap");
              td.style.removeProperty("word-break");
              td.style.removeProperty("text-overflow");
              td.classList.remove("pdf-final-wrap");
            });

            table.querySelectorAll("tbody tr").forEach(row=>{
              row.dataset.shgWrapped="false";
              row.dataset.finalWrapped="false";
            });
          }

          /*
           * DCB FONT RULE:
           * The SHG Name column does NOT become 10pt as a whole.
           * Only the individual SHG Name cells explicitly marked
           * data-shg-font10="true" use 10pt. Every other SHG Name cell,
           * and every other DATA cell, remains 13pt.
           */
          function setDcbFonts(){
            table.querySelectorAll(
              "tbody tr.data-row td, tbody tr.data-row td .pdf-cell-text, "+
              "tbody tr.total td, tbody tr.total td .pdf-cell-text"
            ).forEach(el=>{
              const td=el.closest("td");
              const isShg=td && td.cellIndex===SHG_COL;
              const size=(isShg && td.dataset.shgFont10==="true") ? 10 : 13;

              el.style.setProperty(
                "font-family",'"Gidugu",Arial,sans-serif',"important"
              );
              el.style.setProperty("font-size",`${size}pt`,"important");
              el.style.setProperty("font-weight","400","important");
              el.style.setProperty("font-style","normal","important");
              el.style.setProperty("font-synthesis","none","important");
              el.style.setProperty("line-height","1","important");

              if(td && (td.dataset.wrapShg==="true" || td.dataset.wrapFinal==="true")){
                el.style.setProperty("white-space","normal","important");
                el.style.setProperty("overflow-wrap","anywhere","important");
                el.style.setProperty("word-break","break-word","important");
                el.style.setProperty("overflow","hidden","important");
              }else{
                el.style.setProperty("white-space","nowrap","important");
                el.style.setProperty("overflow","visible","important");
                el.style.setProperty("overflow-wrap","normal","important");
                el.style.setProperty("word-break","normal","important");
              }
            });
          }

          function requiredDcb(){
            const req=Array(count).fill(0);
            const hasData=Array(count).fill(false);

            /* A column containing only numeric zeroes is treated as having no
             * meaningful entered data for HEADER-MINIMUM purposes. This keeps
             * headers such as "కొత్త అప్పు" visible even when every row is 0.
             * The zero values themselves still participate in normal data sizing. */
            const hasMeaningfulData=value=>{
              const t=String(value==null?"":value).trim();
              if(!t)return false;
              const compact=t.replace(/[\s,]/g,"");
              return !/^[-+]?0(?:\.0+)?$/.test(compact);
            };

            dataCells(table).forEach(td=>{
              const col=td.cellIndex;
              if(col<=0 || col>=count)return;
              const text=(td.textContent||"").trim();
              if(hasMeaningfulData(text))hasData[col]=true;
              if(td.dataset.wrapFinal==="true")return;

              const cellSize=(
                col===SHG_COL && td.dataset.shgFont10==="true"
              ) ? 10 : 13;

              if(text){
                req[col]=Math.max(
                  req[col],
                  measureTextPt(td,text,cellSize)+paddingPt(td)+borderPt(td)+2
                );
              }
            });

            /*
             * Header is a SOFT requirement when a column contains data.
             * However, if a column has no data at all, its header must remain
             * visible, so that header text establishes the minimum width.
             */
            table.querySelectorAll("thead tr").forEach(tr=>{
              let col=0;
              Array.from(tr.children).forEach(cell=>{
                const span=cell.colSpan||1;
                if(span===1 && col<count && col!==0 && !hasData[col]){
                  const raw=(cell.innerText||cell.textContent||"").replace(/\r/g,"");
                  const lines=raw.split("\n").map(clean).filter(Boolean);
                  const longest=lines.reduce((a,b)=>b.length>a.length?b:a,"");
                  if(longest){
                    const headerSize=cellFontSizePt(cell);
                    req[col]=Math.max(
                      req[col],
                      measureTextPt(cell,longest,headerSize)+paddingPt(cell)+borderPt(cell)+2
                    );
                  }
                }
                col+=span;
              });
            });

            return req;
          }

          function fitsDcb(widths,size){
            let fits=true;
            dataCells(table).forEach(td=>{
              const col=td.cellIndex;
              if(col<0 || col>=widths.length || col===0)return;
              if(td.dataset.wrapFinal==="true")return;

              const actualSize=(
                col===SHG_COL && td.dataset.shgFont10==="true"
              ) ? 10 : 13;
              const room=Math.max(0,widths[col]-paddingPt(td)-borderPt(td)-2);
              if(measureTextPt(td,td.textContent||"",actualSize)>room+EPS)fits=false;
            });
            return fits;
          }

          /*
           * Apply a width allocation while NEVER touching S.No.
           * redistribute() starts all non-S.No columns equally, then transfers
           * space from every genuine donor to every needy column. If total
           * required width is physically larger than the page, only then does
           * it compress the non-S.No columns proportionally.
           */
          function applyWidths(marginPt,widthPt){
            setStage(marginPt,widthPt);

            const required=requiredDcb();
            const widths=redistribute(required,widthPt);

            setWidths(table,widths);
            void table.offsetWidth;

            return {required,widths};
          }

          resetTableTransform(table);

          if(isDcb){
            clearDcbFallbackStyles();

            /* =============================================================
             * STAGE 1
             * 10 mm left + right, ALL DATA at 13pt.
             * =========================================================== */
            setDcbFonts();
            let result=applyWidths(M10,W10);

            if(fitsDcb(result.widths,13)){
              setDcbRowHeight(table);
              return;
            }

            /* =============================================================
             * STAGE 2
             * ONLY NOW reduce left + right margins to 8 mm.
             * ALL DATA remains 13pt.
             * =========================================================== */
            setDcbFonts();
            result=applyWidths(M8,W8);

            if(fitsDcb(result.widths,13)){
              setDcbRowHeight(table);
              return;
            }

            /* =============================================================
             * STAGE 3
             * ONLY THE INDIVIDUAL SHG NAME CELL(S) THAT NEED IT become 10pt.
             *
             * The entire SHG Name column NEVER changes to 10pt.
             * SHG cells that fit at 13pt stay at 13pt.
             * =========================================================== */
            dataCells(table).forEach(td=>{
              if(td.cellIndex!==SHG_COL)return;

              const room=Math.max(
                0,
                result.widths[SHG_COL]-paddingPt(td)-borderPt(td)-2
              );

              if(measureTextPt(td,td.textContent||"",13)>room+EPS){
                td.dataset.shgFont10="true";
              }
            });

            setDcbFonts();
            result=applyWidths(M8,W8);

            /*
             * Re-check after the mixed 13pt/10pt allocation. If moving
             * space between columns makes another SHG cell become the
             * limiting cell, reduce ONLY that particular cell to 10pt.
             */
            let changed=true;
            let guard=0;
            while(changed && guard++<count){
              changed=false;

              result.widths && dataCells(table).forEach(td=>{
                if(td.cellIndex!==SHG_COL)return;
                if(td.dataset.wrapShg==="true")return;

                const size=(td.dataset.shgFont10==="true")?10:13;
                const room=Math.max(
                  0,
                  result.widths[SHG_COL]-paddingPt(td)-borderPt(td)-2
                );

                if(size===13 &&
                   measureTextPt(td,td.textContent||"",13)>room+EPS){
                  td.dataset.shgFont10="true";
                  changed=true;
                }
              });

              if(changed){
                setDcbFonts();
                result=applyWidths(M8,W8);
              }
            }

            if(fitsDcb(result.widths,13)){
              setDcbRowHeight(table);
              return;
            }

            /*
             * At this point only SHG cells marked above may use 10pt.
             * All other data remains 13pt.
             */
            if(fitsDcb(result.widths,10)){
              setDcbRowHeight(table);
              return;
            }

            /* =============================================================
             * STAGE 4
             * FINAL LEVEL: if a data cell OR Total-row cell still cannot fit,
             * wrap ONLY THAT PARTICULAR CELL. S.No is never wrapped. All other
             * columns remain 13pt; SHG cells already selected for 10pt remain 10pt.
             * ============================================================= */
            dataCells(table).forEach(td=>{
              const col=td.cellIndex;
              if(col<=0 || col>=count)return;
              if(td.dataset.wrapFinal==="true")return;

              const size=(col===SHG_COL && td.dataset.shgFont10==="true")?10:13;
              const room=Math.max(0,result.widths[col]-paddingPt(td)-borderPt(td)-2);
              if(measureTextPt(td,td.textContent||"",size)>room+EPS){
                td.dataset.wrapFinal="true";
                td.classList.add("pdf-final-wrap");
                const row=td.closest("tr");
                if(row)row.dataset.finalWrapped="true";
              }
            });

            setDcbFonts();
            setDcbRowHeight(table);
            return;
          }

          if(isLedger){
            /*
             * Loan Ledger: exact same first two margin stages, 13pt data.
             * There is no SHG Name data column inside the ledger table, so
             * stages 3/4 are not applicable.
             */
            setCommonDataFont(table,13);

            setStage(M10,W10);
            let required=requiredByColumn(table,13);
            /* W10 is the frame's outer width. The table is inside the frame,
             * so reserve its 1px left + 1px right borders. */
            let widths=redistribute(required,Math.max(0.1,W10-2));
            setWidths(table,widths);
            void table.offsetWidth;

            if(allDataCellsFit(table,widths,13)){
              return;
            }

            /* ONLY if 10 mm fails -> 8 mm. */
            setStage(M8,W8);
            setCommonDataFont(table,13);
            required=requiredByColumn(table,13);
            /* Same frame-content-width correction for the 8 mm fallback. */
            widths=redistribute(required,Math.max(0.1,W8-2));
            setWidths(table,widths);
            void table.offsetWidth;

            /* Never reduce Ledger data below 13pt. If still insufficient,
             * wrap only the individual overflowing data cells; S.No remains
             * fixed and is never wrapped. */
            setCommonDataFont(table,13);
            dataCells(table).forEach(td=>{
              const col=td.cellIndex;
              if(col<=0 || col>=widths.length)return;
              const room=Math.max(0,widths[col]-paddingPt(td)-borderPt(td)-2);
              if(measureTextPt(td,td.textContent||"",13)>room+EPS){
                td.classList.add("pdf-final-wrap");
              }
            });
            return;
          }

          /*
           * Any future non-PDF table is left on the existing common fitting
           * path, but PDF tables above use the exact requested fallback order.
           */
          const available=availableWidthForTable(table);
          setCommonDataFont(table,13);
          let required=requiredByColumn(table,13);
          let widths=redistribute(required,available);
          setWidths(table,widths);
          void table.offsetWidth;
        }

        doc.querySelectorAll(
          ".ledger-table, .dcb-table, .cumulative-dcb-table"
        ).forEach(fitOneTable);

        ruler.remove();
      }catch(e){
        try{ console.warn("PDF table fitting error:",e); }catch(ignore){}
      }
    }

    /*
     * DCB header/table alignment.
     * The final table transform and fitted column split are copied to the
     * matching DCB header so the header never remains wider than the table.
     */
    function syncDcbHeadersAfterFit(w){
      try{
        const doc=w.document;

        function sync(frame,table,head){
          if(!frame||!table||!head)return;

          const widthPt=parseFloat(table.dataset.pdfWidthPt)||785.197;
          const widthPx=widthPt*96/72;
          const marginPt=parseFloat(table.dataset.pdfMarginPt)||28.3465;
          const page=table.closest(".dcb-page,.cumulative-dcb-page");

          if(page){
            page.style.setProperty("padding-left",`${marginPt.toFixed(4)}pt`,"important");
            page.style.setProperty("padding-right",`${marginPt.toFixed(4)}pt`,"important");
          }

          [frame,table,head].forEach(el=>{
            el.style.setProperty("width",`${widthPx.toFixed(3)}px`,"important");
            el.style.setProperty("max-width",`${widthPx.toFixed(3)}px`,"important");
            el.style.setProperty("min-width",`${widthPx.toFixed(3)}px`,"important");
            el.style.marginLeft="0";
            el.style.marginRight="0";
            el.style.boxSizing="border-box";
          });

          void table.offsetWidth;

          const dataCols=Array.from(table.querySelectorAll(":scope > colgroup > col"));
          const headCols=Array.from(head.querySelectorAll(":scope > colgroup > col"));

          /*
           * Copy each final rendered data-column width one-for-one to the
           * corresponding header column. The two elements are both tables
           * with table-layout:fixed and border-collapse:collapse.
           */
          dataCols.forEach((dc,i)=>{
            const hc=headCols[i];
            if(!hc)return;
            const r=dc.getBoundingClientRect();
            hc.style.setProperty("width",`${r.width.toFixed(3)}px`,"important");
          });

          void head.offsetWidth;
        }

        /* Every Monthly DCB page independently. */
        doc.querySelectorAll(".dcb-page").forEach(page=>{
          sync(
            page.querySelector(".dcb-frame"),
            page.querySelector(".dcb-table"),
            page.querySelector(".dcb-head")
          );
        });

        /* Every Cumulative DCB page independently. */
        doc.querySelectorAll(".cumulative-dcb-page").forEach(page=>{
          sync(
            page.querySelector(".cumulative-dcb-frame"),
            page.querySelector(".cumulative-dcb-table"),
            page.querySelector(".cumulative-dcb-head")
          );
        });
      }catch(e){
        try{console.warn("DCB header alignment error:",e);}catch(ignore){}
      }
    }

    function printReport(title, body){
      const v=vo();
      const voNameForFile = v && v.name ? String(v.name).trim() : "VO";
      const safeVOName = voNameForFile.replace(/[\\/:*?"<>|]+/g,"_").replace(/\s+/g," ").trim() || "VO";
      // PDF filename is determined by the report title passed to printReport().
      // Report functions pass: DCB, LL, Cumulative-DCB, or VO.
      // Examples: Laxmi-VO-DCB.pdf, Laxmi-VO-LL.pdf,
      // Laxmi-VO-Cumulative-DCB.pdf, and Laxmi-VO.pdf.
      const reportSuffix = String(title || "VO")
        .replace(/^\s*VOName-VO(?:-|$)/i, "")
        .trim();
      const printTitle = safeVOName + "-VO" +
        (reportSuffix && !/^VO$/i.test(reportSuffix) ? "-" + reportSuffix : "");
      const w=window.open("","_blank");
      if(!w){
        alert("Allow pop-ups to print the PDF.");
        return;
      }

      w.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${printTitle}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Gidugu&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${new URL("css/pdf-print-window.css", location.href).href}">
</head>
<body>${body}</body>
</html>`);

      w.document.close();

      const printWhenReady=async()=>{
        try{
          if(w.document.fonts && w.document.fonts.load){
            await w.document.fonts.load('400 13pt "Gidugu"');
            await w.document.fonts.load('100 13pt "Gidugu"');
            await w.document.fonts.load('700 17pt "Gidugu"');
            await w.document.fonts.load('700 12.5pt "Gidugu"');
            await w.document.fonts.ready;
          }
        }catch(e){}
        setTimeout(()=>{
          try{
            /* One universal fitter handles Ledger, Monthly DCB and
               Cumulative DCB. No per-cell font fitting is used. */
            fitAllPDFTablesInPrintWindow(w);

            /*
             * Must run LAST: all table fitting/scaling is complete now,
             * so the DCB headers can copy the final table transform and
             * use the final fitted column widths.
             */
            syncDcbHeadersAfterFit(w);

            w.document.title=printTitle;
          }catch(e){}
          w.print();
        },200);
      };
      printWhenReady();
    }

    /*
     * DCB PAGE LAYOUT
     * ----------------
     * Every DCB table starts with equal columns. The universal print-time
     * engine then expands/redistributes them according to actual data.
     */
    function getDCBPageLayout(v){
      const A4_WIDTH=841.89;
      const MIN_MARGIN=28.3465;
      const totalWidth=A4_WIDTH-(MIN_MARGIN*2); // fixed 10 mm safe area on all sides
      const columnCount=17;
      const widths=Array(columnCount).fill(
        (totalWidth-FIXED_SN_WIDTH)/(columnCount-1)
      );
      widths[0]=FIXED_SN_WIDTH;

      return {
        widths,
        totalWidth,
        left:MIN_MARGIN,
        right:MIN_MARGIN
      };
    }

    /* MS LOGIN PDF RULE (STRICT):
     * Monthly DCB + Cumulative DCB header: MS -> Mandal -> District.
     * Loan Ledger first metadata row: child name + Mandal + District.
     * These rules are active only while currentMode === "MS".
     */
    function monthlyPDF(asPart=false){
      const v=vo();
      if(!v)return;

      const dcbLayout=getDCBPageLayout(v);
      const dcbColStyle=dcbLayout.widths.map(w=>`<col style="width:${w.toFixed(3)}pt">`).join("");
      const dcbPageStyle=`--dcb-width:${dcbLayout.totalWidth.toFixed(3)}pt;--dcb-left:${dcbLayout.left.toFixed(3)}pt;--dcb-right:${dcbLayout.right.toFixed(3)}pt;`;

      let out="";

      MONTHS.forEach((m,mi)=>{
        const allRows=[];
        const totals=Array(15).fill(0);
        let monthlySerial=0;

        v.shgs.forEach((s,i)=>{
          const d=s.months[m[0]];
          if(!monthIsConsidered(d)) return;
          let opening=d.opening;


          const x={...d,opening};
          const c=calc(x);

          /* Monthly DCB PDF:
           * "ఈ నెల డిమాండ్ అసలు" / Current Month Principal must
           * display the value entered for this same month and SHG.
           */
          const currentMonthPrincipal = Number(d.demandPrincipal)||0;

          const vals=[
            opening,
            d.prevPrincipal,
            d.prevInterest,
            currentMonthPrincipal,
            d.demandInterest,
            d.prevPrincipal+currentMonthPrincipal,
            d.prevInterest+d.demandInterest,
            d.prevPrincipal+currentMonthPrincipal+d.prevInterest+d.demandInterest,
            d.principalCollection,
            d.interestCollection,
            c.totalCollection,
            c.balancePrincipal,
            c.balanceInterest,
            d.newLoan,
            c.totalLoanBalance
          ];

          vals.forEach((n,j)=>totals[j]+=Number(n)||0);

          allRows.push(`
            <tr class="data-row">
              <td>${++monthlySerial}</td>
              <td class="shg-name telugu">${esc(s.name)}</td>
              ${vals.map(n=>`<td>${fmt(n)}</td>`).join("")}
            </tr>
          `);
        });

        /*
         * If this month has no completed/considered SHG records,
         * do NOT create a DCB page at all.
         *
         * This prevents an empty month's DCB header from printing.
         */
        if(allRows.length===0) return;

        /*
         * Monthly DCB pagination:
         * maximum 25 real SHG data rows on each A4 landscape page.
         */
        const MAX_DCB_DATA_ROWS_PER_PAGE=25;
        const chunks=[];

        for(let i=0;i<allRows.length;i+=MAX_DCB_DATA_ROWS_PER_PAGE){
          chunks.push(
            allRows.slice(i,i+MAX_DCB_DATA_ROWS_PER_PAGE)
          );
        }

        const totalCells=totals.map(n=>`<td>${fmt(n)}</td>`).join("");

        const nums=[
          "1","2","3","4","5","6","7","8","9","10","11",
          "12","13","14","15","16","17"
        ];

        chunks.forEach((chunk,chunkIndex)=>{
          const isLastPage=chunkIndex===chunks.length-1;
          /*
           * Do NOT pad the table with empty rows.
           * Only real SHG records are rendered.
           * MAX_DCB_DATA_ROWS_PER_PAGE controls pagination only:
           * 25 real rows maximum on each page.
           */
          const blankRows="";

          out+=`
            <section class="page dcb-page" style="${dcbPageStyle}">
              <div class="dcb-frame">
                <!-- Blank/tab-space row at the top of every DCB page. -->
                <div class="dcb-top-blank"></div>
                <table class="dcb-head">
                  <colgroup>${dcbColStyle}</colgroup>
                  <tbody>
                    <tr>
                      <th colspan="10" class="dcb-head-left telugu">
                        ${pdfHeaderLocationText(v)}
                      </th>
                      <th colspan="7" class="dcb-head-right">
                        DCB-${m[0].toUpperCase()}
                      </th>
                    </tr>
                  </tbody>
                </table>

                <table class="dcb-table">
                  <colgroup>
                    ${dcbColStyle}
                  </colgroup>
                  <thead>
                    <tr class="group-head">
                      <th rowspan="2">S.N</th>
                      <th rowspan="2"><span class="telugu">${pdfChildLabel()} పేరు</span></th>
                      <th rowspan="2"><span class="telugu">ప్రారంభ<br>అప్పు నిల్వ</span></th>
                      <th colspan="2"><span class="telugu">గత నెల బకాయి<br>వివరాలు</span></th>
                      <th colspan="2"><span class="telugu">ఈ నెల డిమాండ్</span></th>
                      <th colspan="3"><span class="telugu">గతనెల బకాయి తో కలిపి ఈ నెల<br>వరకు మొత్తం డిమాండ్</span></th>
                      <th colspan="3"><span class="telugu">ఈ నెల కలెక్షన్ వివరాలు</span></th>
                      <th colspan="2"><span class="telugu">బకాయి</span></th>
                      <th rowspan="2"><span class="telugu">కొత్త<br>అప్పు</span></th>
                      <th rowspan="2"><span class="telugu">ముగింపు<br>అప్పు నిల్వ</span></th>
                    </tr>
                    <tr class="sub-head">
                      <th><span class="telugu">అసలు</span></th>
                      <th><span class="telugu">వడ్డీ</span></th>
                      <th><span class="telugu">అసలు</span></th>
                      <th><span class="telugu">వడ్డీ</span></th>
                      <th><span class="telugu">అసలు</span></th>
                      <th><span class="telugu">వడ్డీ</span></th>
                      <th><span class="telugu">మొత్తం</span></th>
                      <th><span class="telugu">అసలు</span></th>
                      <th><span class="telugu">వడ్డీ</span></th>
                      <th><span class="telugu">మొత్తం</span></th>
                      <th><span class="telugu">అసలు</span></th>
                      <th><span class="telugu">వడ్డీ</span></th>
                    </tr>
                    <tr class="number-head">
                      ${nums.map(n=>`<td>${n}</td>`).join("")}
                    </tr>
                  </thead>
                  <tbody>
                    ${chunk.join("")}
                    ${blankRows}
                    ${
                      isLastPage
                      ? `<tr class="total"><td></td><td class="telugu">మొత్తం</td>${totalCells}</tr>`
                      : ""
                    }
                  </tbody>
                </table>
              </div>
            </section>`;
        });
      });

      if(asPart) return out;
      printReport("DCB",out);
    }


    /*
     * CUMULATIVE DCB PDF
     * One row per SHG for Apr-26 through Mar-27.
     *
     * Annual calculation:
     * - Opening = April opening balance.
     * - Previous due = April previous due.
     * - Demand = sum of all stored monthly demands.
     * - Previous + current demand = sum of each month's combined demand.
     * - Collection = sum of all stored monthly collections.
     * - Balance = March year-end balance when March exists.
     * - New Loan = sum of all stored monthly new loans.
     *
     * The visual structure follows the 15-column cumulative DCB format shown in the reference image.
     * Exactly 25 DATA rows are allocated to each page; the final page also
     * contains the Total row.  Rows are kept together and are not split.
     */

    /* CUMULATIVE DCB: 15-COLUMN SCREENSHOT STRUCTURE */
    function cumulativeDcbPDF(asPart=false){
      const v=vo();
      if(!v||!v.shgs.length){
        if(!asPart) alert(`Select a ${pdfParentLabel()} with ${pdfChildLabel()}s.`);
        return "";
      }

      const A4_WIDTH=841.89, MARGIN=28.3465;
      const totalWidth=A4_WIDTH-(MARGIN*2);

      /*
       * Cumulative DCB has 15 columns:
       * 1  S.No
       * 2  SHG Name
       * 3  Opening Loan Balance
       * 4-5 Previous Due: Principal / Interest
       * 6-8 Previous Due + Current Demand: Principal / Interest / Total
       * 9-11 Collection: Principal / Interest / Total
       * 12-13 Balance: Principal / Interest
       * 14 New Loan
       * 15 Closing Loan Balance
       */
      const columnCount=13;
      const widths=Array(columnCount).fill(totalWidth/columnCount);
      const colStyle=widths.map(w=>`<col style="width:${w.toFixed(3)}pt">`).join("");
      const pageStyle=
        `--cumulative-dcb-width:${totalWidth.toFixed(3)}pt;`+
        `--cumulative-dcb-left:${MARGIN.toFixed(3)}pt;`+
        `--cumulative-dcb-right:${MARGIN.toFixed(3)}pt;`;

      /* Numeric columns 3 through 13 = 11 displayed columns. */
      const totals=Array(11).fill(0);
      const rows=[];
      let cumulativeSerial=0;

      v.shgs.forEach((s,i)=>{
        const startIdx=Number.isInteger(s.startMonthIndex)?s.startMonthIndex:0;
        const april=s.months[MONTHS[0][0]]||blank();

        let collectP=0,collectI=0,newLoan=0;
        let lastEntered=null;
        let hasAnyData=false;

        /*
         * Cumulative DCB demand is represented by the latest entered month's
         * previous due + current demand. Collections and new loans are the
         * cumulative sums across all entered months.
         */
        MONTHS.forEach(m=>{
          const d=s.months[m[0]];
          if(!monthIsConsidered(d))return;
          hasAnyData=true;

          lastEntered=d;
          collectP+=Number(d.principalCollection)||0;
          collectI+=Number(d.interestCollection)||0;
          newLoan+=Number(d.newLoan)||0;
        });

        if(!hasAnyData)return;

        /* A mid-year SHG has no April record. Its own creation month is the
         * beginning of its accounting period; earlier months intentionally do
         * not participate in its cumulative totals. April-created SHGs still
         * begin in April as before. */
        const baseData=s.months[MONTHS[startIdx][0]]||blank();
        const opening=Number(baseData.opening)||0;

        /*
         * CUMULATIVE DCB - PREVIOUS DUE
         * --------------------------------
         * "గత బకాయి" must ALWAYS be taken from APRIL:
         *   Previous Due Principal -> April prevPrincipal
         *   Previous Due Interest  -> April prevInterest
         *
         * Do not use the latest month's previous due for these two columns.
         */
        const previousP=Number(baseData.prevPrincipal)||0;
        const previousI=Number(baseData.prevInterest)||0;

        /*
         * CUMULATIVE DCB:
         * Column 6 = Column 4 (April Previous Due Principal)
         *             + Column 6's demand value accumulated so far.
         *
         * Column 7 = Column 5 (April Previous Due Interest)
         *             + Column 7's demand value accumulated so far.
         *
         * In other words:
         *   Column 6 = Previous Due Principal + cumulative Demand Principal
         *   Column 7 = Previous Due Interest  + cumulative Demand Interest
         *
         * The separate Previous Due columns remain the April values.
         */
        let cumulativeDemandP=0;
        let cumulativeDemandI=0;

        MONTHS.forEach(m=>{
          const d=s.months[m[0]];
          if(!monthIsConsidered(d))return;

          cumulativeDemandP += Number(d.demandPrincipal)||0;
          cumulativeDemandI += Number(d.demandInterest)||0;
        });

        const combinedP=
          (Number(previousP)||0) + cumulativeDemandP;

        const combinedI=
          (Number(previousI)||0) + cumulativeDemandI;

        const totalDemand=
          (Number(combinedP)||0) + (Number(combinedI)||0);

        const totalCollection=
          (Number(collectP)||0) + (Number(collectI)||0);
        const balanceP=(Number(combinedP)||0)-(Number(collectP)||0);
        const balanceI=(Number(combinedI)||0)-(Number(collectI)||0);

        /* Closing balance must come from the latest month that actually has
         * data. This is important for a SHG created in the middle of the year:
         * its creation-month New Loan must flow into the next month's opening
         * balance without being counted a second time. If March is entered, it
         * naturally becomes the latest month and is used. */
        const latestCalc=lastEntered?calc(lastEntered):null;
        const closing=latestCalc
          ? Number(latestCalc.totalLoanBalance)||0
          : opening-collectP+newLoan;

        /* Previous Due ("గత బకాయి") is intentionally omitted from the
         * cumulative PDF display. The existing calculations above are unchanged. */
        const vals=[
          opening,
          combinedP,combinedI,totalDemand,
          collectP,collectI,totalCollection,
          balanceP,balanceI,
          newLoan,
          closing
        ];

        vals.forEach((n,j)=>totals[j]+=Number(n)||0);

        rows.push(`
          <tr class="data-row">
            <td>${++cumulativeSerial}</td>
            <td class="shg-name">${esc(s.name)}</td>
            ${vals.map(n=>`<td>${fmt(n)}</td>`).join("")}
          </tr>
        `);
      });

      const MAX_ROWS=25;
      const chunks=[];
      for(let i=0;i<rows.length;i+=MAX_ROWS){
        chunks.push(rows.slice(i,i+MAX_ROWS));
      }
      if(!chunks.length)chunks.push([]);

      const totalCells=totals.map(n=>`<td>${fmt(n)}</td>`).join("");
      const nums=[
        "1","2","3","4","5","6","7","8","9","10",
        "11","12","13"
      ];

      let out="";

      chunks.forEach((chunk,idx)=>{
        const last=idx===chunks.length-1;

        out+=`
          <section class="page cumulative-dcb-page" style="${pageStyle}">
            <div class="cumulative-dcb-frame">
              <div class="dcb-top-blank"></div>

              <table class="cumulative-dcb-head">
                <colgroup>${colStyle}</colgroup>
                <tbody>
                  <tr>
                    <th colspan="8" class="cumulative-dcb-head-left telugu">
                      ${pdfHeaderLocationText(v)}
                    </th>
                    <th colspan="7" class="cumulative-dcb-head-right">
                      Cumulative DCB 2026-27
                    </th>
                  </tr>
                </tbody>
              </table>

              <table class="cumulative-dcb-table">
                <colgroup>${colStyle}</colgroup>
                <thead>
                  <tr class="group-head">
                    <th rowspan="2">S.N</th>
                    <th rowspan="2"><span class="telugu">${pdfChildLabel()} పేరు</span></th>
                    <th rowspan="2"><span class="telugu">ప్రారంభ<br>అప్పు నిల్వ</span></th>

                    <th colspan="3">
                      <span class="telugu">డిమాండ్</span>
                    </th>

                    <th colspan="3">
                      <span class="telugu">కలెక్షన్</span>
                    </th>

                    <th colspan="2">
                      <span class="telugu">బకాయి</span>
                    </th>

                    <th rowspan="2">
                      <span class="telugu">కొత్త<br>అప్పు</span>
                    </th>

                    <th rowspan="2">
                      <span class="telugu">ముగింపు అప్పు<br>నిల్వ</span>
                    </th>
                  </tr>

                  <tr class="sub-head">
                    <!-- Previous + Current Demand -->
                    <th><span class="telugu">అసలు</span></th>
                    <th><span class="telugu">వడ్డీ</span></th>
                    <th><span class="telugu">మొత్తం</span></th>

                    <!-- Collection -->
                    <th><span class="telugu">అసలు</span></th>
                    <th><span class="telugu">వడ్డీ</span></th>
                    <th><span class="telugu">మొత్తం</span></th>

                    <!-- Balance -->
                    <th><span class="telugu">అసలు</span></th>
                    <th><span class="telugu">వడ్డీ</span></th>
                  </tr>

                  <tr class="number-head">
                    ${nums.map(n=>`<td>${n}</td>`).join("")}
                  </tr>
                </thead>

                <tbody>
                  ${chunk.join("")}
                  ${last?`<tr class="total"><td></td><td>మొత్తం</td>${totalCells}</tr>`:""}
                </tbody>
              </table>
            </div>
          </section>`;
      });

      if(asPart) return out;
      printReport("Cumulative-DCB",out);
    }

    /*
     * LOAN LEDGER DATA-DRIVEN WIDTH ENGINE
     * ------------------------------------
     * 1. Start with the normal/reference LL widths.
     * 2. Inspect actual data cells for every month on this SHG's ledger.
     * 3. Expand only columns whose data needs more room.
     * 4. Use unused A4 margin space first.
     * 5. Never shrink base columns while margin space remains.
     * 6. Only constrain requested expansion when physical A4 width is exceeded.
     * 7. Center the final complete content block horizontally.
     */
    /*
     * LOAN LEDGER PAGE LAYOUT
     * All 12 columns start equal. The universal print-time fitting engine
     * performs the content-aware redistribution.
     */
    function getLedgerPageLayout(s,v){
      const A4_WIDTH=841.89;
      const MIN_MARGIN=28.3465;
      const totalWidth=A4_WIDTH-(MIN_MARGIN*2); // fixed 10 mm safe area on all sides
      const columnCount=12;
      const widths=Array(columnCount).fill(totalWidth/columnCount);

      return {
        widths,
        totalWidth,
        left:MIN_MARGIN,
        right:MIN_MARGIN
      };
    }

    function ledgerPDF(asPart=false){
      const v=vo();

      if(!v||!v.shgs.length){
        if(!asPart) alert(`Select a ${pdfParentLabel()} with ${pdfChildLabel()}s.`);
        return "";
      }

      let out="";
      let ledgerSerial=0;

      v.shgs.forEach((s,si)=>{
        const ledgerLayout=getLedgerPageLayout(s,v);
        const ledgerColStyle=ledgerLayout.widths
          .map(w=>`<col style="width:${w.toFixed(3)}pt">`)
          .join("");
        const ledgerPageStyle=
          `--ledger-width:${ledgerLayout.totalWidth.toFixed(3)}pt;`+
          `--ledger-left:${ledgerLayout.left.toFixed(3)}pt;`+
          `--ledger-right:${ledgerLayout.right.toFixed(3)}pt;`;
        const allRows=[];

        MONTHS.forEach((m,i)=>{
          const d=s.months[m[0]];
          if(!monthIsConsidered(d))return;

          const c=calc(d);
          const p=d.prevPrincipal+d.demandPrincipal;
          const ii=d.prevInterest+d.demandInterest;

          allRows.push(`
            <tr>
              <td>${i+1}</td>
              <td class="date">${m[0]}</td>
              <td>${fmt(d.opening)}</td>
              <td>${fmt(p)}</td>
              <td>${fmt(ii)}</td>
              <td>${fmt(d.principalCollection)}</td>
              <td>${fmt(d.interestCollection)}</td>
              <td>${fmt(c.totalCollection)}</td>
              <td>${fmt(p-d.principalCollection)}</td>
              <td>${fmt(ii-d.interestCollection)}</td>
              <td>${fmt(d.newLoan)}</td>
              <td>${fmt(c.totalLoanBalance)}</td>
            </tr>
          `);
        });

        /* Reference LL has one page per SHG with entered/considered data. */
        if(!allRows.length)return;
        ledgerSerial++;
        out+=`
          <section class="page ledger-page" style="${ledgerPageStyle}">
            <div class="ledger-frame">
              <div class="ledger-blank"></div>

              <div class="ledger-title-row">
                <div class="ledger-title telugu">${esc(v.name||"")} ${pdfParentLabel()} - అప్పు లెడ్జర్ 2026-27</div>
                <div class="page-label">Page No:</div>
                <div class="page-number">${ledgerSerial}</div>
              </div>

              <div class="ledger-meta">
                <div class="meta-row">
                  <div class="meta-key telugu">${pdfChildLabel()} పేరు :</div>
                  <div class="meta-value highlight telugu">${esc(s.name)}</div>
                  ${isMsLoginPdf() ? `
                    <!-- MS Login ONLY: Mandal and District are on the same row.
                         Order is strictly MS -> Mandal -> District. -->
                    <div class="meta-key telugu">మండలం :</div>
                    <div class="meta-value telugu">${esc(v.mandal||"")}</div>
                    <div class="meta-key telugu">జిల్లా :</div>
                    <div class="meta-value telugu">${esc(v.district||"")}</div>
                  ` : `
                    <div class="meta-key telugu">${pdfLocationLabelTelugu()} పేరు :</div>
                    <div class="meta-value telugu meta-value-merged">${esc(pdfLocationValue(v))}</div>
                  `}
                </div>

                <div class="meta-row">
                  <div class="meta-key telugu">అప్పు ఇచ్చిన తేది :</div>
                  <div class="meta-empty"></div>
                  <div class="meta-key telugu">అప్పు మొత్తం రూ. :</div>
                  <div class="meta-empty"></div>
                  <div class="meta-key telugu">వడ్డీ రేటు :</div>
                  <div class="meta-value highlight">${fmt(s.interestRate===undefined?12:s.interestRate)}%</div>
                </div>

                <div class="meta-row">
                  <div class="meta-key telugu">వాయిదాల సంఖ్య :</div>
                  <div class="meta-empty"></div>
                  <div class="meta-key telugu">వాయిదా మొత్తం రూ. :</div>
                  <div class="meta-empty"></div>
                  <div class="meta-key telugu">అప్పు రకం :</div>
                  <div class="meta-value highlight">CIF</div>
                </div>
              </div>

              <table class="ledger-table">
                <colgroup>${ledgerColStyle}</colgroup>
                <thead>
                  <tr class="group-head">
                    <th rowspan="2">S.N</th>
                    <th rowspan="2" class="telugu">తేది</th>
                    <th rowspan="2" class="telugu">ప్రారంభ అప్పు<br>నిల్వ</th>
                    <th colspan="2" class="telugu">గత నెల బకాయి + ఈ<br>నెల డిమాండ్</th>
                    <th colspan="3" class="telugu">ఈ నెల కలెక్షన్ వివరాలు</th>
                    <th colspan="2" class="telugu">బకాయి</th>
                    <th rowspan="2" class="telugu">కొత్త అప్పు</th>
                    <th rowspan="2" class="telugu">మొత్తం అప్పు నిల్వ</th>
                  </tr>
                  <tr class="sub-head">
                    <th class="telugu">అసలు</th>
                    <th class="telugu">వడ్డీ</th>
                    <th class="telugu">అసలు</th>
                    <th class="telugu">వడ్డీ</th>
                    <th class="telugu">మొత్తం</th>
                    <th class="telugu">అసలు</th>
                    <th class="telugu">వడ్డీ</th>
                  </tr>
                  <tr class="number-head">
                    <th>1</th><th>2</th><th>3</th><th>4</th><th>5</th><th>6</th><th>7</th><th>8</th><th>10</th><th>11</th><th>12</th><th>13</th>
                  </tr>
                </thead>
                <tbody>${allRows.join("")}</tbody>
              </table>
            </div>
          </section>`;
      });

      if(asPart) return out;
      printReport("LL",out);
    }

    /*
     * ALL 3 PDFS - SINGLE PRINT/PDF DOCUMENT
     * ----------------------------------------
     * Builds the three existing report bodies in their normal order:
     *   1. Monthly DCB
     *   2. Cumulative DCB
     *   3. Loan Ledger
     * and sends all pages to ONE browser print document.
     *
     * Browser Save-as-PDF will therefore create ONE PDF containing all
     * three reports. The document title is also used as the suggested
     * PDF filename: dynamically uses the selected VO name, e.g. Laxmi-VO.pdf.
     */
    function allPdfsPDF(){
      const v=vo();
      if(!v||!v.shgs.length){
        alert(`Select a ${pdfParentLabel()} with ${pdfChildLabel()}s.`);
        return;
      }

      const monthly=monthlyPDF(true)||"";
      const ledger=ledgerPDF(true)||"";
      const cumulative=cumulativeDcbPDF(true)||"";

      /*
       * Combined PDF order:
       *   1. Monthly DCB
       *   2. ONE completely blank A4 page
       *   3. Loan Ledger
       *   4. ONE completely blank A4 page
       *   5. Cumulative DCB
       *
       * The blank pages are intentional separator sheets so each report
       * starts as a clearly separated section in the single PDF.
       */
      const separator=`<section class="page combined-blank-page" aria-hidden="true"></section>`;
      const body=monthly+separator+ledger+separator+cumulative;

      if(!body.trim()){
        alert("There is no PDF data to print.");
        return;
      }

      printReport(pdfParentLabel(),body);
    }

    /* Firebase Login / Sign Up gate.
       Mobile number + username are stored in the user's Profile only.
       No SMS/OTP is used. */
