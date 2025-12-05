import sys
from pypdf import PdfReader

def extract_field_names(pdf_path, output_txt_path):
    print(f"--- Reading PDF: {pdf_path} ---")
    
    try:
        reader = PdfReader(pdf_path)
        fields = reader.get_fields()

        if not fields:
            print("❌ No form fields found in this PDF.")
            return

        print(f"✅ Found {len(fields)} form fields.")
        
        with open(output_txt_path, "w", encoding="utf-8") as f:
            f.write(f"Verification Report for: {pdf_path}\n")
            f.write("="*50 + "\n\n")
            
            for field_name in fields.keys():
                # Write the exact field name to the file
                f.write(f"{field_name}\n")
                
                # OPTIONAL: Console check to see if the "space fix" worked
                if field_name.endswith(" "):
                    print(f"🔹 Detected Space-Fix: '{field_name[-10:]}'")  # Prints last 10 chars

        print(f"\n--- Success! ---")
        print(f"Field names have been saved to: {output_txt_path}")
        print("You can open that text file to verify your questions.")

    except FileNotFoundError:
        print(f"❌ Error: The file '{pdf_path}' was not found.")
    except Exception as e:
        print(f"❌ An error occurred: {e}")

if __name__ == "__main__":
    # Change this filename if your downloaded PDF has a different name
    input_pdf = "edited_form.pdf" 
    output_txt = "verified_questions.txt"

    # Allow running via command line: python verify_fields.py my_file.pdf
    if len(sys.argv) > 1:
        input_pdf = sys.argv[1]

    extract_field_names(input_pdf, output_txt)