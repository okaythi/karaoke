;; Loaded after a LilyPond source's music definitions. Export the resolved
;; music tree (not engraving coordinates), including exact durations/pitches.
;; Usage is documented in docs/piano-karaoke.md.
(use-modules (ice-9 format))

(define (json-string value)
  (string-append "\""
    (string-concatenate
      (map (lambda (c)
        (cond ((char=? c #\") "\\\"") ((char=? c #\\) "\\\\")
              ((char=? c #\newline) "\\n") ((char=? c #\return) "\\r")
              ((char=? c #\tab) "\\t") (else (string c))))
        (string->list value))) "\""))

(define (json-object fields)
  (string-append "{" (string-join
    (map (lambda (field) (string-append (json-string (symbol->string (car field)))
                                       ":" (music-json (cdr field)))) fields) ",") "}"))

(define (music-json value)
  (cond
    ((ly:music? value)
     (json-object (cons (cons 'name (ly:music-property value 'name))
       (filter (lambda (item) (not (memq (car item) '(origin))))
               (ly:music-mutable-properties value)))))
    ((ly:pitch? value)
     (json-object `((step . ,(ly:pitch-notename value))
                   (octave . ,(ly:pitch-octave value))
                   (alter . ,(* 2 (ly:pitch-alteration value))))))
    ((ly:duration? value)
     (json-object `((log . ,(ly:duration-log value))
                   (dots . ,(ly:duration-dot-count value))
                   (factor . ,(ly:duration-scale value)))))
    ((ly:moment? value)
     (json-object `((main . ,(/ (ly:moment-main-numerator value) (ly:moment-main-denominator value)))
                   (grace . ,(/ (ly:moment-grace-numerator value) (ly:moment-grace-denominator value))))))
    ((string? value) (json-string value))
    ((symbol? value) (json-string (symbol->string value)))
    ((boolean? value) (if value "true" "false"))
    ((number? value) (if (integer? value) (number->string value) (json-string (number->string value))))
    ((list? value) (string-append "[" (string-join (map music-json value) ",") "]"))
    ((procedure? value) (json-string (format #f "#<procedure ~a>" (or (procedure-name value) 'anonymous))))
    (else (json-string (format #f "~a" value)))))

(define (export-music filename names)
  (call-with-output-file filename
    (lambda (port)
      (display (json-object (map (lambda (name)
        (cons name (ly:parser-lookup name))) names)) port)
      (newline port))))
